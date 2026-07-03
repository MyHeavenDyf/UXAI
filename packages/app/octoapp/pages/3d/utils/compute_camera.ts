/**
 * compute_camera.ts —— 确定性视角后处理
 * ============================================================================
 * 在场景物体全部生成完毕后运行，纯数学计算相机机位。
 * 零 AI token 消耗，不依赖 Agent 推理。
 *
 * 流水线:
 *   extractViewpointParams(cameraPlan) → 从 intent 提取焦段/俯角/方位角
 *   deriveLookAtFromObjects(objects)    → 从物体列表推导包围盒
 *   computeStandardViewpoint({...})      → 铁律约束 + 包围盒 → 机位
 *
 * 参考: packages/app/octoapp/templates/threejs-skills/skills/threejs-viewpoint/SKILL.md (5 条铁律)
 * ============================================================================
 */

import type { SceneObject, CameraNode, Vec3 } from "./scene-protocol"

// ===========================================================================
// 类型
// ===========================================================================

export interface ViewpointParams {
  focalLength: number // 50–85 mm
  depressionAngle: number // 30°–45°
  azimuthAngle: number // 15°–60°
  /** 呼吸空间系数，用户通过 cameraPlan 明确指定（如"紧凑构图"/"宽松视野"）。未指定则根据实际场景紧凑度自动计算 */
  breathingRoom?: number
}

export interface SceneBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface ViewpointResult {
  position: Vec3
  lookAt: Vec3
  up: Vec3
  fov: number
  focalLength: number
  depressionAngle: number
  azimuthAngle: number
  horizontalDistance: number
}

export interface BoundsValidation {
  match: boolean
  xDeviation: number
  zDeviation: number
  sceneWidthExpected: number
  sceneWidthActual: number
  needsCorrection: boolean
  reason?: string
}

// ===========================================================================
// 默认值
// ===========================================================================

const DEFAULTS: ViewpointParams = {
  focalLength: 65,
  depressionAngle: 37.5,
  azimuthAngle: 45,
}

const SENSOR_HEIGHT = 24 // 35mm 全画幅传感器高度

// ===========================================================================
// Step 1: 从 intent.cameraPlan 提取参数
// ===========================================================================

/**
 * 从自然语言 cameraPlan 中提取视角参数。
 * 未提及的参数使用默认值。
 *
 * @example
 *   extractViewpointParams("65mm中焦，37.5°俯角，3/4视角")
 *   // → { focalLength: 65, depressionAngle: 37.5, azimuthAngle: 45 }
 */
export function extractViewpointParams(cameraPlan?: string): ViewpointParams {
  const params = { ...DEFAULTS }
  if (!cameraPlan) return params

  // 焦段
  const focalMatch = cameraPlan.match(/(\d{2,3})\s*mm/)
  if (focalMatch) {
    const fl = parseInt(focalMatch[1], 10)
    if (fl >= 50 && fl <= 85) params.focalLength = fl
  }

  // 俯角
  const depMatch = cameraPlan.match(/(\d{2})(?:\.\d)?\s*[°度].*?俯/)
  if (depMatch) {
    const da = parseFloat(depMatch[1])
    if (da >= 30 && da <= 45) params.depressionAngle = da
  }

  // 方位角
  const azMatch = cameraPlan.match(/(\d{2})\s*[°度].*?方位/)
  if (azMatch) {
    const az = parseInt(azMatch[1], 10)
    if (az >= 15 && az <= 60) params.azimuthAngle = az
  }
  // "3/4视角" 关键词
  if (cameraPlan.includes("3/4") && !azMatch) {
    params.azimuthAngle = 45
  }

  // 呼吸空间
  if (cameraPlan.includes("紧凑")) {
    params.breathingRoom = 1.02
  } else if (cameraPlan.includes("宽松") || cameraPlan.includes("开阔")) {
    params.breathingRoom = 1.10
  }

  return params
}

// ===========================================================================
// Step 2: 从物体列表推导视觉重心
// ===========================================================================

interface ObjectWithBounds {
  position?: Vec3
  geometry?: {
    type?: string
    params?: Record<string, number | string>
  }
  scale?: Vec3 | number
}

/**
 * 从所有物体推导场景包围盒和视觉重心（lookAt 目标）。
 * Y 轴重心偏移至场景高度的下 1/3 处，使画面不显空旷也不压抑。
 */
export function deriveLookAtFromObjects(
  objects: ObjectWithBounds[],
): { lookAt: Vec3; bounds: SceneBounds } {
  if (!objects || objects.length === 0) {
    return {
      lookAt: [0, 0.5, 0],
      bounds: { minX: -1, maxX: 1, minY: 0, maxY: 1, minZ: -1, maxZ: 1 },
    }
  }

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity

  for (const obj of objects) {
    const px = obj.position?.[0] ?? 0
    const py = obj.position?.[1] ?? 0
    const pz = obj.position?.[2] ?? 0

    // 估算物体的尺寸（半宽、半高、半深）
    const { halfWidth, halfHeight, halfDepth } = estimateObjectHalfSize(obj)

    minX = Math.min(minX, px - halfWidth)
    maxX = Math.max(maxX, px + halfWidth)
    minY = Math.min(minY, py - halfHeight)
    maxY = Math.max(maxY, py + halfHeight)
    minZ = Math.min(minZ, pz - halfDepth)
    maxZ = Math.max(maxZ, pz + halfDepth)
  }

  // 防御性检查：确保包围盒有合理的最小尺寸
  const width = maxX - minX
  const depth = maxZ - minZ
  if (width < 0.5) {
    const expand = (0.5 - width) / 2
    minX -= expand
    maxX += expand
  }
  if (depth < 0.5) {
    const expand = (0.5 - depth) / 2
    minZ -= expand
    maxZ += expand
  }

  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const sceneHeight = maxY - minY
  // 视觉重心在场景高度的下 1/3 处
  const cy = minY + sceneHeight * 0.33

  return {
    lookAt: [cx, cy, cz],
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  }
}

/** 估算物体的尺寸（半宽、半高、半深，用于包围盒计算，非精确） */
function estimateObjectHalfSize(obj: ObjectWithBounds): { halfWidth: number; halfHeight: number; halfDepth: number } {
  const scaleX = typeof obj.scale === "number"
    ? obj.scale
    : Array.isArray(obj.scale)
      ? (obj.scale[0] ?? 1)
      : 1
  const scaleY = typeof obj.scale === "number"
    ? obj.scale
    : Array.isArray(obj.scale)
      ? (obj.scale[1] ?? 1)
      : 1
  const scaleZ = typeof obj.scale === "number"
    ? obj.scale
    : Array.isArray(obj.scale)
      ? (obj.scale[2] ?? 1)
      : 1

  const params = obj.geometry?.params
  if (!params) {
    // 无几何参数时使用默认尺寸
    const defaultSize = 0.5 * scaleY
    return { halfWidth: defaultSize, halfHeight: defaultSize, halfDepth: defaultSize }
  }

  // 常见几何体参数
  const height = typeof params.height === "number" ? params.height : 0
  const radius = typeof params.radius === "number" ? params.radius : 0
  const width = typeof params.width === "number" ? params.width : 0
  const depth = typeof params.depth === "number" ? params.depth : 0

  let halfHeight = 0, halfWidth = 0, halfDepth = 0

  // 根据几何体类型推算尺寸
  const geoType = obj.geometry?.type ?? ""

  if (geoType === "sphere") {
    const r = radius || height / 2 || 0.5
    halfHeight = halfWidth = halfDepth = r
  } else if (geoType === "box" || geoType === "cube") {
    halfHeight = (height || 1) / 2
    halfWidth = (width || height || 1) / 2
    halfDepth = (depth || height || 1) / 2
  } else if (geoType === "cylinder" || geoType === "cone") {
    halfHeight = height / 2
    const r = radius || 0.5
    halfWidth = halfDepth = r
  } else if (geoType === "plane") {
    halfHeight = (height || 1) / 2
    halfWidth = (width || height || 1) / 2
    halfDepth = 0.05
  } else {
    halfHeight = (height || radius || 1) / 2
    halfWidth = halfHeight * 0.6
    halfDepth = halfHeight * 0.6
  }

  return {
    halfWidth: halfWidth * scaleX,
    halfHeight: halfHeight * scaleY,
    halfDepth: halfDepth * scaleZ,
  }
}

// ===========================================================================
// Step 2.5: 从 Planner 聚合预期包围盒
// ===========================================================================

interface SlotWithBounds {
  bounds?: { xMin: number; xMax: number; zMin: number; zMax: number }
  parent_id: string
}

interface GroupWithPosition {
  id: string
  position?: Vec3
}

/**
 * 从 planner 的 slots + groups 聚合预期场景包围盒。
 * 遍历每个 slot 的 bounds，解析其 parent group 的 position 偏移，
 * 汇总出整个场景的预期空间范围。
 */
export function computeExpectedBounds(
  slots: SlotWithBounds[],
  groups: GroupWithPosition[],
): SceneBounds {
  const groupPos = new Map<string, Vec3>()
  for (const g of groups) {
    if (g.position) groupPos.set(g.id, g.position)
  }

  let minX = Infinity, maxX = -Infinity
  let minY = 0, maxY = 3
  let minZ = Infinity, maxZ = -Infinity
  let hasBounds = false

  for (const slot of slots) {
    if (!slot.bounds) continue
    hasBounds = true
    const offset = groupPos.get(slot.parent_id) ?? [0, 0, 0]
    minX = Math.min(minX, offset[0] + slot.bounds.xMin)
    maxX = Math.max(maxX, offset[0] + slot.bounds.xMax)
    minZ = Math.min(minZ, offset[2] + slot.bounds.zMin)
    maxZ = Math.max(maxZ, offset[2] + slot.bounds.zMax)
  }

  if (!hasBounds) {
    return { minX: -5, maxX: 5, minY: 0, maxY: 3, minZ: -5, maxZ: 5 }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ }
}

// ===========================================================================
// 包围盒偏差检测
// ===========================================================================

/**
 * 对比 planner 预期包围盒与物体实际包围盒，检测偏差。
 * @param expected — 从 planner slots 聚合的预期包围盒
 * @param actual — 从实际物体推导的包围盒
 * @param tolerance — 允许的偏差比例，默认 0.3（30%）
 */
export function validateBounds(
  expected: SceneBounds,
  actual: SceneBounds,
  tolerance = 0.3,
): BoundsValidation {
  const expectedWidth = Math.max(expected.maxX - expected.minX, expected.maxZ - expected.minZ, 1)
  const actualWidth = Math.max(actual.maxX - actual.minX, actual.maxZ - actual.minZ, 1)

  const xDeviation = expectedWidth > 0
    ? Math.abs(actualWidth - expectedWidth) / expectedWidth
    : 0
  const zDeviation = expectedWidth > 0
    ? Math.abs((actual.maxZ - actual.minZ) - (expected.maxZ - expected.minZ)) / expectedWidth
    : 0

  const needsCorrection = xDeviation > tolerance || zDeviation > tolerance
  let reason: string | undefined
  if (needsCorrection) {
    const reasons: string[] = []
    if (xDeviation > tolerance) reasons.push(`X轴偏差 ${(xDeviation * 100).toFixed(0)}%`)
    if (zDeviation > tolerance) reasons.push(`Z轴偏差 ${(zDeviation * 100).toFixed(0)}%`)
    reason = reasons.join("; ")
  }

  return {
    match: !needsCorrection,
    xDeviation: Math.round(xDeviation * 1000) / 1000,
    zDeviation: Math.round(zDeviation * 1000) / 1000,
    sceneWidthExpected: Math.round(expectedWidth * 10) / 10,
    sceneWidthActual: Math.round(actualWidth * 10) / 10,
    needsCorrection,
    reason,
  }
}

// ===========================================================================
// 呼吸空间系数计算
// ===========================================================================

/**
 * 根据场景实际尺寸动态计算呼吸空间系数。
 *
 * 核心公式：连续衰减函数，无离散跳变。
 *   breathingRoom = min + amplitude / (1 + diagonal / decay)
 *
 * 原理：
 * - 小场景需要比例更大的留白（传感器尺寸固定，小物体在画面中占比小）
 * - 随场景增大，所需留白比例递减，趋近于 asymptote
 * - 场景越扁平（宽高比大），包围盒估算不确定性越高，略增留白
 *
 * @param objects — 实际物体列表（用于判断空场景）
 * @param bounds — 场景包围盒
 * @returns breathingRoom 系数
 */
export function calculateBreathingBySceneSize(
  objects: SceneObject[],
  bounds: SceneBounds,
): number {
  if (!objects || objects.length === 0) {
    return 1.20
  }

  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const spanY = Math.max(0.5, bounds.maxY - bounds.minY)
  const sceneDiagonal = Math.hypot(spanX, spanZ)

  // 连续衰减：breathingRoom = min + amplitude / (1 + diagonal / decay)
  // diagonal → 0 时趋近 min+amplitude=1.25；diagonal → ∞ 时趋近 min=1.05
  const MIN_BREATHING = 1.05
  const AMPLITUDE = 0.20
  const DECAY = 10
  let breathingRoom = MIN_BREATHING + AMPLITUDE / (1 + sceneDiagonal / DECAY)

  // 扁平场景修正：宽 >> 高时，包围盒高度估算不确定性更大，略微增加留白
  const flatness = Math.max(spanX, spanZ) / Math.max(spanY, 0.5)
  if (flatness > 5) {
    breathingRoom += 0.03
  } else if (flatness > 3) {
    breathingRoom += 0.015
  }

  return Math.round(breathingRoom * 1000) / 1000
}

// ===========================================================================
// Step 3: 焦段 → fov 换算
// ===========================================================================

/** 焦段(mm) → 垂直 fov(度) */
export function focalLengthToFov(focalLength: number): number {
  return 2 * radToDeg(Math.atan(SENSOR_HEIGHT / (2 * focalLength)))
}

// ===========================================================================
// Step 4: 计算标准机位（5 铁律全量约束）
// ===========================================================================

export interface ComputeViewpointOptions {
  /** 场景包围盒（用于动态 lookAt 选择） */
  bounds: SceneBounds
  /** 场景宽度（X 轴跨度） */
  sceneWidth: number
  /** 场景深度（Z 轴跨度），用于精确对角线计算。未提供则回退到 sceneWidth（假设正方形） */
  sceneDepth?: number
  /** 呼吸空间系数，默认 1.08。紧凑场景可用 1.04–1.06，需要更多留白可用 1.12–1.20 */
  breathingRoom?: number
  focalLength?: number
  depressionAngle?: number
  azimuthAngle?: number
  aspect?: number
}

/**
 * 根据焦段 + 俯角 + 方位角 + 场景尺寸计算标准机位。
 * 铁律 1–4 全量校验，参数超范围则抛出错误。
 *
 * 两趟计算：
 *   第一趟以场景垂直中心为假设确定限制方向，
 *   第二趟根据实际 lookAt 修正垂直距离（非居中 lookAt 时上方偏移更大）。
 *
 * lookAt 动态选择策略：
 * - 水平/垂直方向限制 → lookAt Y = 场景垂直中心（紧张方向居中，最大化场景占比）
 * - 对角线方向限制 → lookAt Y = 视觉重心（下 1/3，两方向都宽裕时构图优先）
 */
export function computeStandardViewpoint(options: ComputeViewpointOptions): ViewpointResult {
  const {
    bounds,
    sceneWidth,
    sceneDepth,
    breathingRoom = 1.08,
    focalLength = DEFAULTS.focalLength,
    depressionAngle = DEFAULTS.depressionAngle,
    azimuthAngle = DEFAULTS.azimuthAngle,
    aspect = 16 / 9,
  } = options

  // 铁律校验
  if (focalLength < 50 || focalLength > 85) {
    throw new Error(`焦段 ${focalLength}mm 超出 50–85mm 范围（铁律 1）`)
  }
  if (depressionAngle < 30 || depressionAngle > 45) {
    throw new Error(`俯角 ${depressionAngle}° 超出 30°–45° 范围（铁律 2）`)
  }
  const folded = azimuthAngle > 180 ? 360 - azimuthAngle : azimuthAngle
  const quadrant = folded > 90 ? 180 - folded : folded
  if (quadrant < 15 || quadrant > 60) {
    throw new Error(`方位角 ${azimuthAngle}° 不在 3/4 视角范围 15°–60°（铁律 3）`)
  }

  // 焦段 → fov
  const fovV = focalLengthToFov(focalLength)
  const fovH = 2 * radToDeg(Math.atan(Math.tan(degToRad(fovV / 2)) * aspect))
  const halfFovVRad = degToRad(fovV / 2)
  const halfFovHRad = degToRad(fovH / 2)
  const tanHalfFovV = Math.tan(halfFovVRad)
  const tanHalfFovH = Math.tan(halfFovHRad)

  // 场景尺寸
  const sceneHeight = Math.max(0.5, bounds.maxY - bounds.minY)
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2

  const phi = degToRad(azimuthAngle)
  const theta = degToRad(depressionAngle)

  // ==================================================================
  // Pass 1: 以场景垂直中心为假设，计算三方向距离，确定限制方向
  // ==================================================================

  // 垂直方向（居中假设）：对称，半高 = sceneHeight / 2
  const distanceForVerticalCentered = (sceneHeight / 2) / tanHalfFovV * breathingRoom

  // 水平方向：包围盒在视口水平方向的投影半宽
  // 相机在方位角 φ，视口水平方向在 XZ 平面内垂直于视线方向 (sin φ, cos φ)
  // 视口水平单位向量 = (-cos φ, sin φ)
  // 包围盒角点投影 = |dx * (-cos φ) + dz * (sin φ)| 的最大值
  const halfHorizontalExtent = (spanX / 2) * Math.abs(Math.cos(phi)) + (spanZ / 2) * Math.abs(Math.sin(phi))
  const distanceForHorizontal = halfHorizontalExtent / tanHalfFovH * breathingRoom

  // 对角线方向：视口对角线 FOV
  // 标准公式: tan(fovDiag/2) = sqrt(tan²(fovH/2) + tan²(fovV/2))
  const tanHalfFovDiag = Math.sqrt(tanHalfFovV ** 2 + tanHalfFovH ** 2)
  const sceneHalfDiagonal = Math.hypot(spanX / 2, spanZ / 2)
  const distanceForDiagonal = sceneHalfDiagonal / tanHalfFovDiag * breathingRoom

  // 确定限制方向（用于决定 lookAtY 策略）
  const isVerticalLimited =
    distanceForVerticalCentered > distanceForDiagonal && distanceForVerticalCentered > distanceForHorizontal

  // ==================================================================
  // Pass 2: 精确计算视觉居中的 lookAtY（透视补偿）
  // ==================================================================
  // 俯视时场景下半部分（离相机近）看起来更大，需将 lookAt 下移补偿。
  // 垂直方向限制时用几何中心（最大化场景占比），其他方向用透视补偿。

  let lookAtY: number
  if (isVerticalLimited) {
    // 垂直限制：使用几何中心（不补偿）
    lookAtY = (bounds.minY + bounds.maxY) / 2
  } else {
    // horizontal/diagonal 限制：精确计算透视补偿
    // 先用水平距离的预估值计算 k（这里用 distanceForHorizontal 作为近似）
    const d = distanceForHorizontal / breathingRoom  // 未应用呼吸空间的原始距离
    const y = d * Math.tan(theta) + bounds.maxY - sceneHeight / 2
    const h = d * Math.tan(theta) - bounds.minY
    const alpha = Math.atan(sceneHeight / h)
    const k = Math.tan(theta) / Math.tan(theta + alpha / 2)
    lookAtY = bounds.minY + sceneHeight * k
  }

  // 以实际 lookAtY 为基准，计算向上/向下最大偏移（处理非居中 lookAt 的不对称情况）
  const maxVerticalExtentFromLookAt = Math.max(lookAtY - bounds.minY, bounds.maxY - lookAtY)
  const distanceForVertical = maxVerticalExtentFromLookAt / tanHalfFovV * breathingRoom

  // 取三方向最大值作为最终水平距离
  const horizontalDistance = Math.max(distanceForVertical, distanceForDiagonal, distanceForHorizontal)

  // 计算相机位置
  const eyeY = lookAtY + horizontalDistance * Math.tan(theta)
  const posX = centerX + horizontalDistance * Math.sin(phi)
  const posZ = centerZ + horizontalDistance * Math.cos(phi)

  return {
    position: [posX, eyeY, posZ],
    lookAt: [centerX, lookAtY, centerZ],
    up: [0, 1, 0], // 铁律 4: 画面端正
    fov: Math.round(fovV * 10) / 10,
    focalLength,
    depressionAngle,
    azimuthAngle,
    horizontalDistance: Math.round(horizontalDistance * 10) / 10,
  }
}

// ===========================================================================
// 主入口: 计算场景默认相机
// ===========================================================================

export interface ComputeSceneCameraInput {
  cameraPlan?: string
  objects: SceneObject[]
  aspect?: number
  /** 从 planner slots 聚合的预期包围盒，传入则执行检视 */
  expectedBounds?: SceneBounds
  /** 呼吸空间系数（优先级低于 cameraPlan 明确指定，高于自动计算） */
  breathingRoom?: number
}

export interface ComputeSceneCameraOutput {
  camera: CameraNode
  validation: BoundsValidation | null
}

/**
 * 后处理主入口: 输入 intent 的 cameraPlan + 所有已生成物体，输出 CameraNode。
 * 整个流程零 AI 参与。若传入 expectedBounds，会与实际物体包围盒对比检测偏差。
 *
 * 呼吸空间系数优先级：cameraPlan 明确指定 > 调用传入 > 自动计算
 */
export function computeSceneCamera(input: ComputeSceneCameraInput): ComputeSceneCameraOutput {
  const { cameraPlan, objects, aspect = 16 / 9, expectedBounds, breathingRoom: inputBreathingRoom } = input

  let params = extractViewpointParams(cameraPlan)

  const { bounds } = deriveLookAtFromObjects(objects)
  const sceneWidth = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1)
  const sceneDepth = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)

  const finalBreathingRoom =
    params.breathingRoom ?? inputBreathingRoom ?? calculateBreathingBySceneSize(objects, bounds)

  let vp: ViewpointResult
  try {
    vp = computeStandardViewpoint({
      bounds,
      sceneWidth,
      sceneDepth,
      breathingRoom: finalBreathingRoom,
      focalLength: params.focalLength,
      depressionAngle: params.depressionAngle,
      azimuthAngle: params.azimuthAngle,
      aspect,
    })
  } catch (e) {
    console.warn(`[viewpoint] 相机参数超出铁律范围，使用默认值: ${(e as Error).message}`)
    params = { ...DEFAULTS, breathingRoom: params.breathingRoom }
    vp = computeStandardViewpoint({
      bounds,
      sceneWidth,
      sceneDepth,
      breathingRoom: finalBreathingRoom,
      focalLength: params.focalLength,
      depressionAngle: params.depressionAngle,
      azimuthAngle: params.azimuthAngle,
      aspect,
    })
  }

  let validation: BoundsValidation | null = null
  if (expectedBounds) {
    validation = validateBounds(expectedBounds, bounds)
  }

  const camera: CameraNode = {
    type: "perspective",
    position: vp.position,
    lookAt: vp.lookAt,
    perspective: {
      fov: vp.fov,
      near: 0.1,
      far: Math.max(vp.horizontalDistance * 6, 100),
    },
  }

  return { camera, validation }
}

// ===========================================================================
// 工具函数
// ===========================================================================

function degToRad(deg: number): number {
  return deg * (Math.PI / 180)
}

function radToDeg(rad: number): number {
  return rad * (180 / Math.PI)
}
