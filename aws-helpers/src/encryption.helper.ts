import * as aws from 'aws-sdk';
import * as localEncryption from '@nestjs-yalc/utils/encryption.helper';

/**
 *  Used for everything locally, must still be passed since sometimes we want to use other keys
 * (think encryptionKey on for example user identity document)
 * @todo put this in a config file
 */
export const staticKey =
  'be088f8bb64166cc2938b1dd0c9db8fa223edd975f48462858a41f70ebee1c5f';

export enum EncryptMode {
  AWS,
  LOCAL,
}

export const decryptCallback = (resolve: any, reject: any) => {
  return (err: any, data: any) => {
    if (err) {
      return reject(err);
    }
    data.Plaintext =
      typeof data.Plaintext === 'undefined' ? '' : data.Plaintext;
    return resolve(data.Plaintext.toString());
  };
};

export const asyncDecrypt = async (toDecrypt: any): Promise<string> => {
  const kms = new aws.KMS();
  return new Promise((resolve, reject) => {
    kms.decrypt(
      { CiphertextBlob: Buffer.from(toDecrypt, 'base64') },
      decryptCallback(resolve, reject),
    );
  });
};

// return reject to prevent further func execution (although promise result won't change after reject/resolve)
// also guarantees typescript safety
export const asyncEncrypt = async (toEncrypt: string): Promise<string> => {
  const kms = new aws.KMS();
  const encryptionResult: aws.KMS.CiphertextType = await new Promise(
    (resolve, reject) => {
      // This should never occur, as this function is only called remotely. Throw Error just in case of bad remote env.
      if (typeof process.env.AWS_REMOTE_KEYID === 'undefined') {
        throw new Error(
          'Calling kms encrypt function without setting the AWS_REMOTE_KEYID variable',
        );
      }
      kms.encrypt(
        {
          KeyId: process.env.AWS_REMOTE_KEYID,
          Plaintext: toEncrypt,
        },
        (err, data) => {
          if (err) {
            return reject(err);
          }
          if (typeof data.CiphertextBlob === 'undefined') {
            return reject(
              'Error CiphertextBlob coming from kms encrypt is undefined',
            );
          }
          resolve(data.CiphertextBlob);
        },
      );
    },
  );
  return encryptionResult.toString('base64');
};

/**
 * Method used to decrypt string with AWS. In case of local environment it performs a localEncryption with a staticKey as default
 * @param toDecrypt
 * @param encryptionKey
 * @returns
 */
export const decryptString = async (
  toDecrypt: any,
  encryptMode: EncryptMode,
  encryptionKey = staticKey,
): Promise<string> => {
  switch (encryptMode) {
    case EncryptMode.AWS:
      const decryptionResult: string = await asyncDecrypt(toDecrypt);
      return decryptionResult.toString();
    case EncryptMode.LOCAL:
    default:
      return localEncryption.decryptAes(toDecrypt, encryptionKey);
  }
};

/**
 * Method used to encryptString with AWS. In case of local environment it performs a localEncryption with a staticKey as default
 * @param toDecrypt
 * @param encryptionKey
 * @returns
 */
export const encryptString = async (
  toEncrypt: any,
  encryptMode: EncryptMode,
  encryptionKey = staticKey,
): Promise<string> => {
  switch (encryptMode) {
    case EncryptMode.AWS:
      const encryptionResult: string = await asyncEncrypt(toEncrypt);
      return encryptionResult;
    case EncryptMode.LOCAL:
    default:
      return localEncryption.encryptAes(toEncrypt, encryptionKey);
  }
};

export const decryptSsmVariable = async (
  toDecrypt: string,
): Promise<string> => {
  const ssm = new aws.SSM();

  return new Promise((resolve) => {
    ssm.getParameter(
      {
        Name: toDecrypt,
        WithDecryption: true,
      },
      (err, data) => {
        if (err || !data.Parameter?.Value) {
          resolve('');
        } else {
          resolve(data.Parameter.Value);
        }
      },
    );
  });
};

/**
 * This function set the process.env variables passed as paramenter with the corrisponding ssm variable decrypted
 * @param envVariableToDecrypt mapping variable between process.env and ssm variables name
 */
export const setEnvironmentVariableFromSsm = async (envVariableToDecrypt: {
  [key: string]: string;
}) => {
  for (const variable of Object.keys(envVariableToDecrypt)) {
    process.env[variable] = await decryptSsmVariable(
      envVariableToDecrypt[variable],
    );
  }
};
