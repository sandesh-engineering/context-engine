import { Readable, PassThrough } from 'stream';
import { MagicByteSniffer, SniffResult } from './magic-byte-sniffer';
import { CountingStream } from './counting-stream';

export interface StreamValidationOptions {
  maxBytes: number;
}

export interface ValidatedStreamResult {
  stream: Readable;
  countingStream: CountingStream;
  sniffResult: SniffResult;
}

export class StreamValidator {
  /**
   * Sniffs the first data chunk of an incoming stream for magic bytes,
   * validates it, and pipes the rest through a CountingStream without losing bytes.
   */
  static async validateAndWrapStream(
    inputStream: Readable,
    options: StreamValidationOptions,
  ): Promise<ValidatedStreamResult> {
    return new Promise((resolve, reject) => {
      let isFirstChunk = true;
      const countingStream = new CountingStream({ maxBytes: options.maxBytes });
      const outputPassThrough = new PassThrough();

      const cleanup = () => {
        inputStream.removeListener('data', onData);
        inputStream.removeListener('error', onError);
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onData = (chunk: Buffer) => {
        if (isFirstChunk) {
          isFirstChunk = false;
          cleanup();

          try {
            const sniffResult = MagicByteSniffer.sniff(chunk);
            MagicByteSniffer.validatePdf(chunk);

            // Pipe counting stream to outputPassThrough
            countingStream.pipe(outputPassThrough);

            // Forward first chunk into counting stream
            countingStream.write(chunk);

            // Resume piping the rest of inputStream into countingStream
            inputStream.pipe(countingStream);

            resolve({
              stream: outputPassThrough,
              countingStream,
              sniffResult,
            });
          } catch (valErr) {
            inputStream.destroy();
            reject(valErr);
          }
        }
      };

      inputStream.once('error', onError);
      inputStream.on('data', onData);

      inputStream.once('end', () => {
        if (isFirstChunk) {
          cleanup();
          try {
            MagicByteSniffer.validatePdf(Buffer.alloc(0));
          } catch (emptyErr) {
            reject(emptyErr);
          }
        }
      });
    });
  }
}
