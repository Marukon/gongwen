import type { CSSProperties } from 'react'
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
    '--body-font': config.body.fontFamily,
    '--body-size': `${config.body.fontSize}pt`,
    '--body-line-height': `${config.body.lineSpacing}pt`,
    '--body-indent': `${config.body.firstLineIndent}em`,
    '--layout-char-width': `${getGridCharacterWidthTwips(config) / 20}pt`,
    '--char-spacing': `${getCharacterSpacingTwips(config) / 20}pt`,
    '--h1-font': config.advanced.h1.fontFamily,
    '--h1-size': `${config.advanced.h1.fontSize}pt`,
    '--h2-font': config.advanced.h2.fontFamily,
    '--h2-size': `${config.advanced.h2.fontSize}pt`,
    '--h3-font': config.advanced.h3.fontFamily,
    '--h3-size': `${config.advanced.h3.fontSize}pt`,
    '--page-number-font': config.specialOptions.pageNumberFont,
  } as CSSProperties
}
