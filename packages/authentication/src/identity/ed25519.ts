import {
  BinaryBlob,
  blobFromHex,
  blobFromUint8Array,
  blobToHex,
  derBlobFromBlob,
  DerEncodedBlob,
  KeyPair,
  PublicKey,
  SignIdentity,
} from '@dfinity/agent';
import * as tweetnacl from 'tweetnacl';

export class Ed25519PublicKey implements PublicKey {
  public static from(key: PublicKey) {
    return this.fromDer(key.toDer());
  }

  public static fromRaw(rawKey: BinaryBlob): Ed25519PublicKey {
    return new Ed25519PublicKey(rawKey);
  }

  public static fromDer(derKey: BinaryBlob): Ed25519PublicKey {
    return new Ed25519PublicKey(this.derDecode(derKey));
  }

  // The length of Ed25519 public keys is always 32 bytes.
  private static RAW_KEY_LENGTH = 32;

  // Adding this prefix to a raw public key is sufficient to DER-encode it.
  // See https://github.com/dfinity/agent-js/issues/42#issuecomment-716356288
  private static DER_PREFIX = Uint8Array.from([
    ...[48, 42], // SEQUENCE
    ...[48, 5], // SEQUENCE
    ...[6, 3], // OBJECT
    ...[43, 101, 112], // Ed25519 OID
    ...[3], // OBJECT
    ...[Ed25519PublicKey.RAW_KEY_LENGTH + 1], // BIT STRING
    ...[0], // 'no padding'
  ]);

  private static derEncode(publicKey: BinaryBlob): DerEncodedBlob {
    if (publicKey.byteLength !== Ed25519PublicKey.RAW_KEY_LENGTH) {
      const bl = publicKey.byteLength;
      throw new TypeError(
        `ed25519 public key must be ${Ed25519PublicKey.RAW_KEY_LENGTH} bytes long (is ${bl})`,
      );
    }

    // https://github.com/dfinity/agent-js/issues/42#issuecomment-716356288
    const derPublicKey = Uint8Array.from([
      ...Ed25519PublicKey.DER_PREFIX,
      ...new Uint8Array(publicKey),
    ]);

    return derBlobFromBlob(blobFromUint8Array(derPublicKey));
  }

  private static derDecode(key: BinaryBlob): BinaryBlob {
    const expectedLength = Ed25519PublicKey.DER_PREFIX.length + Ed25519PublicKey.RAW_KEY_LENGTH;
    if (key.byteLength !== expectedLength) {
      const bl = key.byteLength;
      throw new TypeError(
        `Ed25519 DER-encoded public key must be ${expectedLength} bytes long (is ${bl})`,
      );
    }

    const rawKey = blobFromUint8Array(key.subarray(Ed25519PublicKey.DER_PREFIX.length));
    if (!this.derEncode(rawKey).equals(key)) {
      throw new TypeError(
        'Ed25519 DER-encoded public key is invalid. A valid Ed25519 DER-encoded public key ' +
          `must have the following prefix: ${Ed25519PublicKey.DER_PREFIX}`,
      );
    }

    return rawKey;
  }

  private readonly rawKey: BinaryBlob;
  private readonly derKey: DerEncodedBlob;

  // `fromRaw` and `fromDer` should be used for instantiation, not this constructor.
  private constructor(key: BinaryBlob) {
    this.rawKey = key;
    this.derKey = Ed25519PublicKey.derEncode(key);
  }

  public toDer(): DerEncodedBlob {
    return this.derKey;
  }

  public toRaw(): BinaryBlob {
    return this.rawKey;
  }
}

export class Ed25519KeyIdentity extends SignIdentity {
  public static generate(seed?: Uint8Array): Ed25519KeyIdentity {
    const { publicKey, secretKey } =
      seed === undefined ? tweetnacl.sign.keyPair() : tweetnacl.sign.keyPair.fromSeed(seed);
    return new this(
      Ed25519PublicKey.fromRaw(blobFromUint8Array(publicKey)),
      blobFromUint8Array(secretKey),
    );
  }

  // Derive an Ed25519 key pair according to SLIP 0010:
  // https://github.com/satoshilabs/slips/blob/master/slip-0010.md
  public static async fromSeedWithSlip0010(seed: Uint8Array): Promise<Ed25519KeyIdentity> {
    const encoder = new TextEncoder();
    const rawKey = encoder.encode('ed25519 seed');
    const key = await window.crypto.subtle.importKey(
      'raw',
      rawKey,
      {
        name: 'HMAC',
        hash: { name: 'SHA-512' },
      },
      false,
      ['sign'],
    );
    const result = await window.crypto.subtle.sign('HMAC', key, seed.buffer);
    const slipSeed = new Uint8Array(result.slice(0, 32));
    return this.generate(slipSeed);
  }

  public static fromJSON(json: string): Ed25519KeyIdentity {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      const [publicKeyDer, privateKeyRaw] = parsed;
      if (typeof publicKeyDer === 'string' && typeof privateKeyRaw === 'string') {
        return new Ed25519KeyIdentity(
          Ed25519PublicKey.fromDer(blobFromHex(publicKeyDer)),
          blobFromHex(privateKeyRaw),
        );
      } else {
        throw new Error('Deserialization error: JSON must have at least 2 items.');
      }
    } else if (typeof parsed === 'object' && parsed !== null) {
      const { publicKey, _publicKey, secretKey, _privateKey } = parsed;
      const pk = publicKey
        ? Ed25519PublicKey.fromRaw(blobFromUint8Array(new Uint8Array(publicKey.data)))
        : Ed25519PublicKey.fromDer(blobFromUint8Array(new Uint8Array(_publicKey.data)));

      if (publicKey && secretKey && secretKey.data) {
        return new Ed25519KeyIdentity(pk, blobFromUint8Array(new Uint8Array(secretKey.data)));
      } else if (_publicKey && _privateKey && _privateKey.data) {
        return new Ed25519KeyIdentity(pk, blobFromUint8Array(new Uint8Array(_privateKey.data)));
      }
    }
    throw new Error(`Deserialization error: Invalid JSON type for string: ${JSON.stringify(json)}`);
  }

  public static fromKeyPair(publicKey: BinaryBlob, privateKey: BinaryBlob): Ed25519KeyIdentity {
    return new Ed25519KeyIdentity(Ed25519PublicKey.fromRaw(publicKey), privateKey);
  }

  protected _publicKey: Ed25519PublicKey;

  // `fromRaw` and `fromDer` should be used for instantiation, not this constructor.
  protected constructor(publicKey: PublicKey, protected _privateKey: BinaryBlob) {
    super();
    this._publicKey = Ed25519PublicKey.from(publicKey);
  }

  /**
   * Serialize this key to JSON.
   */
  public toJSON(): any {
    return [blobToHex(this._publicKey.toDer()), blobToHex(this._privateKey)];
  }

  /**
   * Return a copy of the key pair.
   */
  public getKeyPair(): KeyPair {
    return {
      secretKey: blobFromUint8Array(new Uint8Array(this._privateKey)),
      publicKey: this._publicKey,
    };
  }

  /**
   * Return the public key.
   */
  public getPublicKey(): PublicKey {
    return this._publicKey;
  }

  /**
   * Signs a blob of data, with this identity's private key.
   */
  public async sign(blob: BinaryBlob): Promise<BinaryBlob> {
    const signature = tweetnacl.sign.detached(blob, this._privateKey);
    return blobFromUint8Array(signature);
  }
}