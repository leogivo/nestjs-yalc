import { createParamDecorator, ExecutionContext, Type } from '@nestjs/common';
import { GqlExecutionContext, ReturnTypeFuncValue } from '@nestjs/graphql';
import {
  IFieldMapper,
  FieldMapperProperty,
} from '@nestjs-yalc/interfaces/maps.interface';
import {
  columnConversion,
  formatRawSelection,
  objectToFieldMapper,
} from '@nestjs-yalc/ag-grid/ag-grid.helpers';
import { ClassType } from '@nestjs-yalc/types/globals';
import { GraphQLResolveInfo } from 'graphql';
import { removeSymbolicSelection } from './ag-grid-args.decorator';
import {
  IAgGridFieldMetadata,
  IFieldAndFilterMapper,
} from './object.decorator';

export interface IGqlAgSingleParams {
  id: Type<any>;
}

export interface IKeyMeta {
  fieldMapper: FieldMapperProperty | IAgGridFieldMetadata;
  isNested?: boolean;
  rawSelect: string;
}

export const GqlAgGridFieldsMapper = (
  data: IFieldMapper | ReturnTypeFuncValue | ClassType,
  info: GraphQLResolveInfo,
): { keys: string[]; keysMeta: { [key: string]: IKeyMeta } } => {
  const fieldMapper = objectToFieldMapper(data);

  /**
   * Selections
   */
  let keys: Array<string> = [];

  /**
   * Custom or Derived keys
   */
  const keysMeta: { [key: string]: IKeyMeta } = {};

  const processSubItems = (
    mapper: IFieldAndFilterMapper,
    item: any,
    prefix = '',
    path = '',
  ) => {
    if (path && !path.endsWith('.')) path += '.';

    /**
     * Do not process fields that are not actual fields (pageData etc)
     * @todo improve this logic by using metadata on these properties instead of the hardcoded name
     */
    if (item.name.value === 'pageData' && item.selectionSet) return;

    if (item.selectionSet) {
      item.selectionSet.selections.forEach((subItem: any) => {
        /**
         * if it's a nested item, then recurse
         */
        if (subItem.selectionSet) {
          const extraInfo = mapper.extraInfo?.[subItem.name.value];
          if (extraInfo) {
            const nestedMapper = objectToFieldMapper(extraInfo);

            if (item.name.value === 'nodes') {
              processSubItems(nestedMapper, subItem, prefix, path);
              return;
            }

            const _path = path + subItem.name.value;
            processSubItems(nestedMapper, subItem, subItem.name.value, _path);

            // add required fields that have not been selected by the client
            Object.keys(nestedMapper.field).forEach((k: string) => {
              const v: FieldMapperProperty = nestedMapper.field[k];
              const key = _path + '.' + v.dst;
              if (v.isRequired && !keysMeta[key]) {
                keysMeta[key] = {
                  fieldMapper: v,
                  isNested: true,
                  rawSelect: formatRawSelection(v.dst, k, subItem.name.value),
                };
              }
            });
          }

          return;
        }

        if (item.name.value === 'nodes') {
          processSubItems(mapper, subItem, prefix, path);
          return;
        }

        // We have to set a prefix when the parent is a nested item different by "nodes"
        const _prefix = item.name.value;

        // const _path =
        //   item.name.value !== 'nodes' ? path + item.name.value + '.' : path;

        const dst = columnConversion(
          subItem.name.value,
          mapper.field,
        ).toString();

        const _path = !path ? path + item.name.value + '.' : path;

        const key = _path + dst;

        keysMeta[key] = {
          fieldMapper: mapper.field[subItem.name.value],
          isNested: true,
          rawSelect: formatRawSelection(dst, subItem.name.value, _prefix),
        };

        return;
      });
      return;
    }

    const dst = columnConversion(item.name.value, mapper.field).toString();
    const key = path + dst;
    const isNested = !!path;

    /**
     * If the field is derived we want to add it to the selection
     */

    if (isNested || mapper.field[item.name.value]?.mode === 'derived') {
      keysMeta[key] = {
        fieldMapper: mapper.field[item.name.value],
        isNested,
        rawSelect: formatRawSelection(dst, item.name.value, prefix),
      };

      return;
    }

    keys.push(key);
  };

  /**
   * START Process first level fields
   */

  /**
   * Process selected fields
   */
  info.fieldNodes?.[0].selectionSet?.selections.forEach((item: any) =>
    processSubItems(fieldMapper, item),
  );

  /**
   * Process required fields
   */
  // add required fields that have not been selected by the client
  Object.keys(fieldMapper.field).forEach((k: string) => {
    const v: FieldMapperProperty = fieldMapper.field[k];
    if (v.isRequired) {
      if (v.mode === 'derived') {
        if (keysMeta[v.dst]) return;

        keysMeta[v.dst] = {
          fieldMapper: v,
          isNested: false,
          rawSelect: formatRawSelection(v.dst, k, ''),
        };
        return;
      }

      keys.indexOf(v.dst) < 0 && keys.push(v.dst);
    }
  });

  /**
   * Remove symbolic fields that can't be used for the database
   */
  keys = removeSymbolicSelection(keys, fieldMapper.field, '');

  return { keys, keysMeta };
};

export const GqlInfoGenerator = (
  data: IFieldMapper | ReturnTypeFuncValue | ClassType = {},
  ctx: ExecutionContext,
): string[] => {
  const gqlCtx = GqlExecutionContext.create(ctx);
  const info = gqlCtx.getInfo();
  return GqlAgGridFieldsMapper(data, info).keys;
};

export const GqlFieldsMap = createParamDecorator(GqlInfoGenerator);
