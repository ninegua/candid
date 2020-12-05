// tslint:disable:max-classes-per-file
// This file is based on:
// tslint:disable-next-line: max-line-length
// https://github.com/dfinity-lab/dfinity/blob/9bca65f8edd65701ea6bdb00e0752f9186bbc893/docs/spec/public/index.adoc#cbor-encoding-of-requests-and-responses
import BigNumber from 'bignumber.js';
import borc from 'borc';
import { Buffer } from 'buffer/';
import * as cbor from 'simple-cbor';
import { CborEncoder, SelfDescribeCborSerializer } from 'simple-cbor';
import { Principal } from './principal';
import { BinaryBlob, blobFromBuffer, blobFromHex } from './types';

// We are using hansl/simple-cbor for CBOR serialization, to avoid issues with
// encoding the uint64 values that the HTTP handler of the client expects for
// canister IDs. However, simple-cbor does not yet provide deserialization so
// we are using `BigNumber` and `Buffer` types instead of `BigInt` and
// `Uint8Array` (respectively) so that we can use the dignifiedquire/borc CBOR
// decoder.

class PrincipalEncoder implements CborEncoder<Principal> {
  public get name() {
    return 'Principal';
  }

  public get priority() {
    return 0;
  }

  public match(value: any): boolean {
    return value && value._isPrincipal === true;
  }

  public encode(v: Principal): cbor.CborValue {
    return cbor.value.bytes(v.toBlob());
  }
}

class BufferEncoder implements CborEncoder<Buffer> {
  public get name() {
    return 'Buffer';
  }

  public get priority() {
    return 1;
  }

  public match(value: any): boolean {
    return Buffer.isBuffer(value);
  }

  public encode(v: Buffer): cbor.CborValue {
    return cbor.value.bytes(new Uint8Array(v));
  }
}

class BigNumberEncoder implements CborEncoder<BigNumber> {
  public get name() {
    return 'BigNumber';
  }

  public get priority() {
    return 1;
  }

  public match(value: any): boolean {
    return value instanceof BigNumber;
  }

  public encode(v: BigNumber): cbor.CborValue {
    // Always use a bignumber encoding.
    if (v.isPositive() || v.isZero()) {
      return cbor.value.tagged(2, cbor.value.bytes(blobFromHex(v.toString(16))));
    } else {
      return cbor.value.tagged(3, cbor.value.bytes(blobFromHex(v.multipliedBy(-1).toString(16))));
    }
  }
}

const serializer = SelfDescribeCborSerializer.withDefaultEncoders(true);
serializer.addEncoder(new PrincipalEncoder());
serializer.addEncoder(new BufferEncoder());
serializer.addEncoder(new BigNumberEncoder());

export enum CborTag {
  Uint64LittleEndian = 71,
  Semantic = 55799,
}

export const encode = (value: any): BinaryBlob => {
  return blobFromBuffer(Buffer.from(serializer.serialize(value)));
};

export function decode<T>(input: Uint8Array): T {
  const decoder = new borc.Decoder({
    size: input.byteLength,
    tags: {
      [CborTag.Semantic]: (value: T): T => value,
    },
  });
  const result = decoder.decodeFirst(input);
  if (result.hasOwnProperty('canister_id')) {
    result.canister_id = Principal.fromText(result.canister_id.toString(16));
  }
  return result;
}