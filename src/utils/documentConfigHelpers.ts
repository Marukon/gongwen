import { DEFAULT_CONFIG, type DeepPartial, type DocumentConfig } from '../types/documentConfig'

export type LegacyDocumentConfig = DeepPartial<DocumentConfig> & {
  headings?: {
    h1?: {
      fontFamily?: string
      fontSize?: number
    }
    h2?: {
      fontFamily?: string
      fontSize?: number
    }
  }
}

/** 将 patch 深合并到 target，返回新对象 */
export function deepMerge<T extends object>(target: T, patch: DeepPartial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) continue
    const patchVal = patch[key]
    const targetVal = target[key]
    if (
      patchVal !== null &&
      patchVal !== undefined &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        patchVal as DeepPartial<Record<string, unknown>>,
      ) as T[keyof T]
    } else if (patchVal !== undefined) {
      result[key] = patchVal as T[keyof T]
    }
  }
  return result
}

export function migrateLegacyHeadingConfig(parsed: LegacyDocumentConfig): DeepPartial<DocumentConfig> {
  if (!parsed.headings) return parsed

  const { headings, advanced, ...rest } = parsed

  return {
    ...rest,
    advanced: {
      ...advanced,
      h1: {
        ...advanced?.h1,
        fontFamily: advanced?.h1?.fontFamily ?? headings.h1?.fontFamily,
        fontSize: advanced?.h1?.fontSize ?? headings.h1?.fontSize,
      },
      h2: {
        ...advanced?.h2,
        fontFamily: advanced?.h2?.fontFamily ?? headings.h2?.fontFamily,
        fontSize: advanced?.h2?.fontSize ?? headings.h2?.fontSize,
      },
    },
  }
}

export function normalizeLineSpacing(config: DocumentConfig): DocumentConfig {
  const titleLineSpacing = Math.max(config.title.lineSpacing, config.title.fontSize)
  const bodyLineSpacing = Math.max(
    config.body.lineSpacing,
    config.body.fontSize,
    config.advanced.h1.fontSize,
    config.advanced.h2.fontSize,
    config.advanced.h3.fontSize,
  )

  if (
    titleLineSpacing === config.title.lineSpacing &&
    bodyLineSpacing === config.body.lineSpacing
  ) {
    return config
  }

  return {
    ...config,
    title: {
      ...config.title,
      lineSpacing: titleLineSpacing,
    },
    body: {
      ...config.body,
      lineSpacing: bodyLineSpacing,
    },
  }
}

function checkFields(patch: unknown, schema: object, path = 'config') {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(`模板字段 ${path} 应为配置对象。`)
  for (const [key, expected] of Object.entries(schema)) {
    const value = (patch as Record<string, unknown>)[key]
    if (value === undefined) continue
    const field = path + '.' + key
    if (typeof expected === 'object') checkFields(value, expected, field)
    else if (typeof value !== typeof expected ||
      (typeof value === 'number' && (!Number.isFinite(value) || value < 0 ||
        (['fontSize', 'lineSpacing'].includes(key) && value === 0))) ||
      (field === 'config.header.mode' && value !== 'formal' && value !== 'note') ||
      (key === 'pageNumberStyle' && value !== 'mirrored' && value !== 'center')) {
      throw new Error(`模板字段 ${field} 的值无效。`)
    }
  }
}

export function normalizeDocumentConfig(parsed: LegacyDocumentConfig): DocumentConfig {
  checkFields(parsed, DEFAULT_CONFIG)
  if (parsed.headings !== undefined) checkFields(parsed.headings, { h1: DEFAULT_CONFIG.advanced.h1, h2: DEFAULT_CONFIG.advanced.h2 }, 'headings')
  const config = normalizeLineSpacing(deepMerge(DEFAULT_CONFIG, migrateLegacyHeadingConfig(parsed)))
  if (config.margins.left + config.margins.right >= 21 || config.margins.top + config.margins.bottom >= 29.7)
    throw new Error('页边距超出了 A4 纸张范围。')
  return config
}
