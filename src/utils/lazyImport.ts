/** 判断是否为「部署后旧 chunk 失效」类错误 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /Failed to fetch dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)
    || /Loading chunk [\d]+ failed/i.test(msg)
    || /error loading dynamically imported module/i.test(msg)
  )
}

/**
 * 动态 import 失败时：若是 chunk 失效，刷新一次页面（sessionStorage 防死循环）
 * 返回是否已触发刷新（调用方应中止后续逻辑）
 */
export function reloadOnceOnChunkError(err: unknown, key = 'chunk-reload'): boolean {
  if (!isChunkLoadError(err)) return false
  try {
    const flag = sessionStorage.getItem(key)
    if (flag === '1') {
      sessionStorage.removeItem(key)
      return false // 已刷新过仍失败，交给上层提示
    }
    sessionStorage.setItem(key, '1')
    window.location.reload()
    return true
  } catch {
    return false
  }
}
