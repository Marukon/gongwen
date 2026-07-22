import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 计算"固定真实尺寸元素"适配容器宽度所需的总体缩放比例。
 *
 * 用法：将固定 baseWidth 的元素（如 794px 的真实 A4 页）放入 frameRef 容器，
 * 对本元素施加 `transform: scale(scale)`，即可把整张纸等比缩放到容器可用宽度。
 * scale 上限为 1（不放大，保持"真跟 A4 纸一样大"），不足时缩小。
 *
 * 注意：transform 不影响布局，调用方需自行把外层容器高度设为
 * `真实总高度 * scale`，否则会出现多余空白或滚动区域不准。
 */
export function useFitScale(baseWidth: number): {
  frameRef: RefObject<HTMLDivElement | null>
  scale: number
} {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const compute = () => {
      const available = frame.clientWidth
      if (available <= 0) return
      const next = Math.min(1, available / baseWidth)
      setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev))
    }

    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [baseWidth])

  return { frameRef, scale }
}
