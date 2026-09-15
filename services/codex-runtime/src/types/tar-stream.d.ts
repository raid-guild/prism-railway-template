declare module 'tar-stream' {
  const tar: {
    pack(): {
      on(event: 'data', handler: (chunk: Buffer) => void): void;
      on(event: 'end' | 'error', handler: (...args: any[]) => void): void;
      entry(
        header: { name: string; type?: 'file' | 'directory' },
        content: string | Buffer,
        callback: (error?: Error | null) => void,
      ): void;
      finalize(): void;
    };
    extract(): {
      on(event: string, handler: (...args: any[]) => void): void;
      end(buffer: Buffer): void;
    };
  };

  export default tar;
}
