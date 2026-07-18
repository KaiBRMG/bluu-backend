// Ambient types for the untyped `google-fonts` helper package.
// It builds a Google Fonts CDN <link> for the given families/styles.
declare module "google-fonts" {
  type FontStyles = boolean | string | number | Array<string | number>;

  interface GoogleFonts {
    /** Returns a `<link ... rel="stylesheet">` HTML string for the fonts. */
    (fonts: Record<string, FontStyles>): string;
    /** Appends the stylesheet link to `document.head` (browser only). */
    add(fonts: Record<string, FontStyles>): HTMLLinkElement;
  }

  const googleFonts: GoogleFonts;
  export default googleFonts;
}
