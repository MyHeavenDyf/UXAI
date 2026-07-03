---
name: threejs-viewpoint
description: Three.js 相机视角 — 焦段、俯角、方位角约束，场景布局方向映射。用于设置展示视角、规划物体排列方向、确保画面端正与视觉统一。

---

# Three.js Viewpoint

> **定位：** 本规范是视角设计的**权威参考**——定义场景初始展示视角的全部约束规则和计算公式。Agent 生成场景时应以本文档为准则；确定性后处理模块 `compute_camera.ts` 是本文档的纯数学实现，起辅助执行作用。
>
> **相机计算：** 精确的 camera position/fov/lookAt 由 `computeSceneCamera()` 根据实际场景包围盒纯数学计算（三方向比较 + 两趟法 + 呼吸空间连续衰减）。Agent 不需要计算具体数值，但布局方向必须与意图中的视角方向一致。
>
> **用户交互：** 场景生成后的 OrbitControls 完全自由，不做任何角度锁定。

---

## Quick Start

```javascript
// 正确的默认展示视角（65mm 焦段, 37.5° 俯角, 45° 方位角）
const camera = new THREE.PerspectiveCamera(
  21,  // fov ≈ 65mm 焦段（全画幅传感器 24mm 高）
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

// 3/4 视角：相机在 +X/+Z 象限，看向场景中心
camera.position.set(8, 7, 8);
camera.lookAt(0, 0.5, 0);
// camera.up 保持默认 (0, 1, 0) — 铁律：画面端正，地平线水平

// 注：精确的 position/fov 由 computeSceneCamera() 根据实际场景包围盒自动计算。
//     Agent 只需确保布局方向与视角方向一致即可。
```

## Camera Constraints

相机的最终呈现画面由 **三个维度** 共同控制：

```
   焦段 (focal length)      俯角 (depression)       方位角 (azimuth)
   50mm–85mm 中焦段          30°–45° 俯视            15°–60° 3/4视角
         │                        │                        │
   控制透视变形程度          控制顶面/立面比例        控制正面/侧面比例
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  ▼
                    最终画面（端正无倾斜）
          自然比例 + 顶面立面兼顾 + 正面侧面兼顾
          地平线水平 + 垂直线条不倾斜
```

### Focal Length（50mm–85mm 中焦段）

焦段决定透视变形的程度。短焦（广角）产生夸张的近大远小畸变，长焦压缩空间层次。

| 焦段 | fov (垂直) | 透视特点 | 适用场景 |
|------|-----------|---------|---------|
| **50mm** | **≈27°** | 标准人眼透视，场景信息量最大 | 大空间全景、建筑群 |
| **65mm** | **≈21°** | 微微压缩，比例最自然 — **默认推荐** | 通用场景、产品展示 |
| **85mm** | **≈16°** | 明显压缩感，专注主体 | 特写、单物体聚焦 |

- **< 50mm**（广角）：近大远小畸变明显，比例失真 — **不合格**
- **50mm–85mm**（中焦）：接近人眼自然透视 — **唯一允许的展示范围**
- **> 85mm**（长焦）：空间压缩过强，失去深度感 — **不合格**

焦段 → fov 换算：`fov = 2 × arctan(24 / (2 × 焦距))`（35mm 全画幅传感器 24mm 高）

**✓ 正确：65mm 中焦段，比例自然**
```javascript
const camera = new THREE.PerspectiveCamera(21, aspect, 0.1, 1000);
```

**✗ 错误：24mm 广角，比例失真**
```javascript
const camera = new THREE.PerspectiveCamera(53, aspect, 0.1, 1000);  // 广角畸变
```

### Depression Angle（30°–45° 俯视）

俯角决定顶面与立面的信息比例。

| 俯角 | 顶面可见度 | 立面可见度 |
|------|----------|----------|
| 30° | ★★★ 很清晰 | ★★★ 清晰 |
| **37.5°** | **★★★ 清晰** | **★★★ 清晰** |
| 45° | ★★ 可辨 | ★★★★ 突出 |

- **< 30°**：顶面消失 → 不合格
- **30°–45°**：顶面与立面同时清晰 → **唯一允许的展示范围**
- **> 45°**：立面板压缩 → 不合格

**✓ 正确：37.5° 俯角，顶面与立面均衡**
```javascript
// horizontalDistance 由包围盒计算，此处为示例值 12m
const eyeY = lookAt.y + 12 * Math.tan(37.5 * Math.PI / 180);  // Y ≈ lookAt.y + 9.2
camera.position.set(8, eyeY, 8);
```

**✗ 错误：平视（俯角 0°），顶面不可见**
```javascript
camera.position.set(8, lookAt.y, 8);  // 退化为立面图
```

### Azimuth Angle（15°–60° 3/4 视角）

相机必须使观众同时看到**整个场景**的正面与侧面，体现场景的空间纵深与立体结构。这是**场景级别**的约束，场景中所有物体共享同一个 3/4 视角方向。

| 方位角 φ | 可见立面 | 立体感 | 判定 |
|----------|---------|--------|------|
| 0° | 仅正面/背面 | ❌ 退化为平面图 | 不合格 |
| 90° | 仅左面/右面 | ❌ 退化为平面图 | 不合格 |
| 15°–30° | 正多侧少 | ⚠️ 偏弱 | 勉强可用 |
| **30°–60°** | **正面 + 侧面同时清晰** | **✅ 立体结构完整** | **合格** |
| **45°（推荐）** | **正面 ≈ 侧面（面积比≈1:1）** | **✅ 最佳立体表现** | **推荐默认** |

方位角定义（以场景坐标系为参考，XZ 平面内，φ 从 +Z 轴顺时针）：

```
            +Z (场景正面/前景)
            │
        φ=0°│ 正对场景正面
            │
   ─────────┼───────── +X (场景右侧)
    φ=90°   │   φ=45° (3/4对角线)
    正对场景│   场景正面+右侧同时可见 ← 推荐
     右侧  │
```

**✓ 正确：45° 方位角，正面+侧面同时可见**
```javascript
const phi = 45 * Math.PI / 180;
camera.position.set(
  lookAt.x + distance * Math.sin(phi),  // +X（场景右侧）
  eyeY,
  lookAt.z + distance * Math.cos(phi),  // +Z（场景正面）
);
```

**✗ 错误：正前方（方位角 0°），退化为平面**
```javascript
camera.position.set(0, eyeY, distance);  // 仅见正面，无立体感
```

### Horizon（画面端正）

- **地平线水平**：场景中水平线条在画面中不倾斜 → `camera.up = (0, 1, 0)`
- **垂直线不倾斜**：建筑、设备等物体的垂直线在画面中保持垂直 → roll = 0

```javascript
// 始终使用默认 up 向量
camera.up.set(0, 1, 0);  // 铁律：画面端正
// 不要修改 up，不要设置 roll
```

### Parameter Consistency（同组资产统一）

| 参数 | 必须一致 |
|------|---------|
| **焦段 / fov** | ✅ |
| **俯角** | ✅ |
| **方位角** | ✅ |
| **camera.up** | ✅ (0, 1, 0) |
| **near / far** | ✅ |
| **aspect** | ✅ |

---

## Camera Distance Calculation

相机到场景的水平距离 `d` 由 **三方向比较** 决定：分别计算垂直/水平/对角线方向所需的距离，取最大值确保场景在任意方向上都完整可见。

> `dv = max(lookAtY - minY, maxY - lookAtY) / tan(fovV/2)` — 垂直方向
> `dh = halfHorizontalExtent / tan(fovH/2)` — 水平方向（方位角投影）
> `dd = sceneHalfDiagonal / tan(fovDiag/2)` — 对角线方向
>
> `d = max(dv, dh, dd) × breathingRoom`

### Two-Pass Strategy（两趟计算）

lookAt 的 Y 坐标取决于哪个方向限制了相机距离，但距离计算又依赖 lookAt 位置。采用两趟法解决这个循环依赖：

**Pass 1 — 确定限制方向：** 假设 lookAt 在场景垂直中心 `(minY + maxY) / 2`（对称），计算三方向距离，确定哪个方向为瓶颈。

**Pass 2 — 动态 lookAt + 修正距离：** 根据限制方向设定实际 lookAt，重新计算垂直距离。

### Three-Direction Comparison（三方向比较）

**1. Vertical（垂直方向）** — 场景高度必须在视口垂直 FOV 内完整可见。lookAt 不在垂直中心时，向上/向下的偏移量不对称，取较大值：

> `maxVerticalExtent = max(lookAtY - minY, maxY - lookAtY)`
> `distanceForVertical = maxVerticalExtent / tan(fovV / 2)`

**2. Horizontal（水平方向）** — 场景在 XZ 平面的包围盒投影到视口水平方向上。视口水平方向在 XZ 平面内垂直于视线 `(sin φ, cos φ)`，水平单位向量为 `(-cos φ, sin φ)`：

> `halfHorizontalExtent = (spanX / 2) × |cos φ| + (spanZ / 2) × |sin φ|`
> `distanceForHorizontal = halfHorizontalExtent / tan(fovH / 2)`

其中 `spanX = maxX - minX`，`spanZ = maxZ - minZ`，`φ` 为方位角。

| φ | cos φ | sin φ | halfHorizontalExtent（spanX=spanZ=W） |
|---|-------|-------|--------------------------------------|
| 15° | 0.97 | 0.26 | 0.61 W |
| 30° | 0.87 | 0.50 | 0.68 W |
| **45°** | **0.71** | **0.71** | **0.71 W** |
| 60° | 0.50 | 0.87 | 0.68 W |

> 最大投影在 φ=45° 时出现（对正方形场景），约为 `W / √2`。

**3. Diagonal（对角线方向）** — 场景 XZ 对角线需要在视口对角线方向上可见。视口对角线 FOV 标准公式：

> `tan(fovDiag / 2) = sqrt(tan²(fovH / 2) + tan²(fovV / 2))`

注意：这里不使用 `sin(diagAngle)` 因子。对角线 FOV 由水平和垂直 FOV 直接合成，与屏幕对角线的物理角度无关。

> `sceneHalfDiagonal = sqrt((spanX / 2)² + (spanZ / 2)²)`
> `distanceForDiagonal = sceneHalfDiagonal / tan(fovDiag / 2)`

### Dynamic lookAt Selection（lookAt 动态选择）

限制方向决定 lookAt 的 Y 坐标策略：

| 限制方向 | lookAt Y | 视觉原理 |
|---------|----------|---------|
| **horizontal** | `(minY + maxY) / 2` | 水平紧张，垂直有余 → 居中对称 |
| **vertical** | `(minY + maxY) / 2` | 垂直紧张，水平有余 → 居中最大化场景占比 |
| **diagonal** | `minY + height × 0.33` | 两方向都宽裕 → 视觉重心构图优先 |

紧张方向（horizontal/vertical）应居中 lookAt 以最小化相机距离。仅当两方向都宽裕时（diagonal），才用 lower 1/3 构图规则。

### Breathing Room（呼吸空间）

呼吸空间系数基于场景对角线长度**连续衰减**，无离散跳变：

> `breathingRoom = 1.05 + 0.20 / (1 + diagonal / 10)`

| 场景对角线 | breathingRoom | 说明 |
|-----------|-------------|------|
| 2m | 1.217 | 小物体需要比例更大的留白 |
| 5m | 1.183 | 小房间级别 |
| 15m | 1.130 | 标准展厅 |
| 30m | 1.100 | 建筑群 |
| 60m | 1.079 | 园区级，趋近下界 1.05 |

**扁平修正：** 场景宽高比 `max(spanX, spanZ) / spanY` 超过 3 时额外 +0.015，超过 5 时额外 +0.03。扁平场景的包围盒高度估算不确定性更高，需要略增留白。

---

## Direction Mapping（Three.js 右手坐标系）

以相机在 +X/+Z 象限（方位角 45°）看向原点为例：

| 用户说的 | 世界坐标 | 从相机视角看 |
|---------|---------|------------|
| **左** | -X | 画面左侧 |
| **右** | +X | 画面右侧 |
| **远 / 背景** | -Z | 画面深处（离相机更远） |
| **近 / 前景** | +Z | 画面前方（离相机更近） |
| **上方** | +Y | 画面上方 |
| **下方** | -Y | 画面下方 |

---

## Layout Guide（Agent 必读）

### 3/4 视角下的空间组织

当相机采用 3/4 视角（默认方位角 45°）时，场景的 **+X 面和 +Z 面同时可见**。布局应遵循：

1. **主物体放在场景中心**（X=0, Z=0 附近），确保从 3/4 角度看到的是物体的正面 + 侧面
2. **前景物体（近相机侧）不应遮挡主物体**：近相机侧是 +X/+Z 方向，陪衬物沿 -X/-Z 方向放置
3. **多行/多层排列方向**：行的展开方向应沿场景对角线 (1, 0, 1) 方向（即 +X/+Z 方向），而非固定沿 -Z 轴
   - 第一行（最远、背景）放在相机视角的远侧：X 最小 + Z 最小 方向
   - 后续行逐步向相机靠近：X 递增 + Z 递增
   - 例如两行：上行 group.position = [-2, 0, -2]，下行 group.position = [2, 0, 2]

```javascript
// 两行排列示例：沿对角线 (1,0,1) 方向展开
// 第一行（背景，离相机最远）
group1.position.set(-2, 0, -2);  // -X/-Z 远侧
// 第二行（前景，离相机最近）
group2.position.set(2, 0, 2);    // +X/+Z 近侧
```

4. **Slot bounds 沿视角方向展开**：为每个 slot 划定 bounds 时，使区域沿视角对角方向排列，前景 slot 的 bounds 在 +X/+Z 区域，背景 slot 的 bounds 在 -X/-Z 区域

### 各 slot bounds 的视角定位

为每个 slot 分配 bounds 时，考虑其相对相机的方位：

- **前景 slot**（离相机近）：bounds 应在 +X/+Z 区域
- **中景 slot**（主物体）：bounds 应在中心区域（X≈0, Z≈0）
- **背景 slot**（离相机远）：bounds 应在 -X/-Z 区域

### 灯光与视角协调

- **主光（directional）应从相机可见的正面打来**：即主光位置大致在相机同侧（+X/+Z 方向偏上方），使光影从观众可见面产生，避免背光
- **辅光从对侧补光**：减少暗部过黑

```javascript
// 主光：与相机同侧（+X/+Z），从上方照亮场景正面
const keyLight = new THREE.DirectionalLight(0xffffff, 1);
keyLight.position.set(5, 8, 5);     // +X/+Z 象限，与 45° 相机同侧
keyLight.castShadow = true;

// 辅光：从对侧（-X/-Z）补光，减少暗部
const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-3, 4, -3);  // 对侧补光
```

---

## Invalid Configurations

| 违规配置 | 问题 | 违反约束 |
|---------|------|---------|
| fov=50（≈24mm） | 广角畸变，近大远小夸张 | Focal Length |
| fov=75（≈16mm） | 超广角，边缘严重拉伸 | Focal Length |
| 纯顶视 | 顶面 100%，立面 0% | Depression Angle |
| 平视 | 立面 100%，顶面 0% | Depression Angle |
| 仰视 | 看不到顶面 | Depression Angle |
| 俯角 20°（太浅） | 顶面几乎不可见 | Depression Angle |
| 俯角 60°（太陡） | 立面压缩成线 | Depression Angle |
| 正前方 `position=[0, *, 18]` | 仅见正面，退化为平面 | Azimuth Angle |
| 正侧方 `position=[18, *, 0]` | 仅见侧面，退化为平面 | Azimuth Angle |
| 方位角 10°（偏正前方） | 侧面严重压缩 | Azimuth Angle |
| 方位角 80°（偏正侧方） | 正立面严重压缩 | Azimuth Angle |
| camera.up 非 (0,1,0) | 画面倾斜，地平线不平 | Horizon |
| roll ≠ 0 | 建筑垂直线倾斜 | Horizon |

---

## Reference（场景尺寸 → 机位速查）

以下为 65mm、fov≈21°、俯角 37.5°、方位角 45°、breathingRoom 由连续衰减公式自动计算时的**近似机位**（精确值由 `computeSceneCamera()` 根据实际包围盒动态计算）：

| 场景对角线 | 水平距离 d（约） | 相机 Y（约） | 3/4 对角线 position（约） |
|-----------|---------------|------------|------------------------|
| ~2m（单桌面） | 3.5m | 2.7m | `[2.5, 2.7, 2.5]` |
| ~5m（小房间） | 9m | 6.9m | `[6.4, 6.9, 6.4]` |
| ~15m（大展厅） | 26m | 20m | `[18, 20, 18]` |
| ~30m（建筑群） | 51m | 39m | `[36, 39, 36]` |
| ~60m（园区级） | 98m | 75m | `[69, 75, 69]` |

> **精确机位由后处理模块 `computeSceneCamera()` 纯数学计算，Agent 不需要计算具体数值。** 上方数值仅供参考，实际值取决于场景包围盒的精确尺寸。

---

## Presets

| 预设 | 焦段 | 俯角 | 方位角 | 用途 |
|------|------|------|--------|------|
| **default** | 65mm | 37.5° | 45° | 透视最自然，所有场景首选 |
| overview | 50mm | 37.5° | 45° | 场景信息量最大，适合大空间全景 |
| closeup | 85mm | 37.5° | 45° | 主体突出，适合产品/设备特写 |
| frontVariant | 65mm | 35° | 35° | 强调立面结构 |

---

## Reference Implementation

本 Skill 是视角设计的**权威规范**。具体计算由确定性后处理模块 `computeSceneCamera()` 执行，零 AI token 消耗。

| 组件 | 职责 |
|------|------|
| **SKILL.md（本文档）** | 约束定义、铁律规则、公式规范 |
| **`compute_camera.ts`** | 纯数学实现，根据包围盒计算精确机位 |

### 计算流程

```
cameraPlan（intent 层）
  ↓ extractViewpointParams() → 焦段/俯角/方位角
物体列表
  ↓ deriveLookAtFromObjects() → SceneBounds
  ↓ computeStandardViewpoint()
      ├─ Pass 1: 居中假设 → 三方向比较 → 限制方向
      ├─ Pass 2: 动态 lookAt → 修正垂直距离
      └─ 呼吸空间连续衰减
  → ViewpointResult (position, lookAt, fov, ...)
```

### Agent 集成

- Agent 通过 `cameraPlan` 指定焦段/俯角/方位角，不需要计算具体数值
- `proto_3d_planner` 不输出 camera（由后处理模块生成）
- 生成/修改场景后自动调用 `computeSceneCamera()` 重算机位
- 包围盒与规划偏差过大时输出 warning 日志

---

## See Also

- `threejs-fundamentals` — 坐标系、Object3D 变换、渲染器设置
- `threejs-lighting` — 灯光类型、阴影、环境光照
- `threejs-geometry` — 几何体与网格生成
- `compute_camera.ts` — 确定性视角后处理实现（`packages/app/octoapp/pages/3d/utils/`）
