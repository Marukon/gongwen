import type { CSSProperties } from 'react'
import { getPreviewMixedFontFamily } from '../../utils/fontAliases'
import { cmToPagePercent, type DocumentConfig } from '../../types/documentConfig'
import { getCharacterSpacingTwips, getGridCharacterWidthTwips } from '../../utils/documentLayout'

export function signaturePadding(indentChars: number): string {
  return `calc(var(--layout-char-width, var(--body-size, 16pt)) * ${indentChars})`
}

export function buildA4CssVars(config: DocumentConfig): CSSProperties {
  return {
    '--margin-top': `${cmToPagePercent(config.margins.top, 'x')}%`,
    '--margin-bottom': `${cmToPagePercent(config.margins.bottom, 'x')}%`,
    '--margin-left': `${cmToPagePercent(config.margins.left, 'x')}%`,
    '--margin-right': `${cmToPagePercent(config.margins.right, 'x')}%`,
    '--margin-bottom-y': `${cmToPagePercent(config.margins.bottom, 'y')}%`,
    '--title-font': config.title.fontFamily,
    '--title-size': `${config.title.fontSize}pt`,
    '--title-line-height': `${config.title.lineSpacing}pt`,
    '--body-east': config.body.fontFamily,
    '--body-font': getPreviewMixedFontFamily(config.body.fontFamily, config.body.asciiFontFamily),
    '--h2-weight': config.specialOptions.boldHeading2 ? 'bold' : 'normal',
    '--signature-gap-lines': config.specialOptions.hasStamp ? 3 : 1,
    '--body-size': `${config.body.fontSize}pt`,
    '--body-line-height': `${config.body.lineSpacing}pt`,
    '--body-indent': `${config.body.firstLineIndent}em`,
    '--layout-char-width': `${getGridCharacterWidthTwips(config) / 20}pt`,
    '--char-spacing': `${getCharacterSpacingTwips(config) / 20}pt`,
    '--h1-east': config.advanced.h1.fontFamily,
    '--h1-font': getPreviewMixedFontFamily(config.advanced.h1.fontFamily, config.advanced.h1.asciiFontFamily),
    '--h1-size': `${config.advanced.h1.fontSize}pt`,
    '--h2-east': config.advanced.h2.fontFamily,
    '--h2-font': getPreviewMixedFontFamily(config.advanced.h2.fontFamily, config.advanced.h2.asciiFontFamily),
    '--h2-size': `${config.advanced.h2.fontSize}pt`,
    '--h3-east': config.advanced.h3.fontFamily,
    '--h3-font': getPreviewMixedFontFamily(config.advanced.h3.fontFamily, config.advanced.h3.asciiFontFamily),
    '--h3-size': `${config.advanced.h3.fontSize}pt`,
    '--page-number-font': config.specialOptions.pageNumberFont,
  } as CSSProperties
}
