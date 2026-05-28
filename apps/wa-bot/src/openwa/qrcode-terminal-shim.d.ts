/**
 * Minimal type declaration for the `qrcode-terminal` package.
 *
 * The package ships no .d.ts of its own. We narrow to the one function we
 * actually call: `generate(text, options, callback)`.
 */
declare module 'qrcode-terminal' {
  type Generate = {
    (text: string, opts: { small?: boolean }, callback: (rendered: string) => void): void;
    (text: string, callback: (rendered: string) => void): void;
  };
  const qrcodeTerminal: {
    generate: Generate;
    setErrorLevel: (level: 'L' | 'M' | 'Q' | 'H') => void;
  };
  export default qrcodeTerminal;
}
