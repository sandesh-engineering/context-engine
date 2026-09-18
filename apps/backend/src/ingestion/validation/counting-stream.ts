import { Transform, TransformCallback } from 'stream';
import { PayloadTooLargeException } from '@nestjs/common';

export interface CountingStreamOptions {
  maxBytes: number;
  onLimitExceeded?: (bytesRead: number, maxBytes: number) => void;
}

export class CountingStream extends Transform {
  private _bytesRead = 0;
  private readonly maxBytes: number;
  private readonly onLimitExceeded?: (bytesRead: number, maxBytes: number) => void;

  constructor(options: CountingStreamOptions) {
    super();
    this.maxBytes = options.maxBytes;
    this.onLimitExceeded = options.onLimitExceeded;
  }

  get bytesRead(): number {
    return this._bytesRead;
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this._bytesRead += buffer.length;

    if (this._bytesRead > this.maxBytes) {
      if (this.onLimitExceeded) {
        this.onLimitExceeded(this._bytesRead, this.maxBytes);
      }
      const error = new PayloadTooLargeException(
        `File size limit exceeded: Maximum allowed is ${this.maxBytes} bytes, received ${this._bytesRead} bytes`,
      );
      return callback(error);
    }

    this.push(buffer);
    callback();
  }
}
