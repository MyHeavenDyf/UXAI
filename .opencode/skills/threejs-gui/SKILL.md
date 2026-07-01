---
name: threejs-gui
description: Three.js GUI overlays, transform controls, parameter panels, CSS renderers, lil-gui. Use when adding HTML/CSS overlays, transform gizmos, tweak panels, screenshot tools, or custom UI for 3D scenes.
triggers:
  - "GUI"
  - "UI"
  - "界面"
  - "面板"
  - "面板按钮"
  - "工具栏"
  - "操作面板"
  - "参数面板"
  - "控制器"
  - "gizmo"
  - "拖动控制"
  - "截图"
  - "全屏"
  - "标签"
  - "标注"
  - "悬浮"
  - "信息面板"
  - "overlay"
  - "lil-gui"
---


# Three.js GUI

## Quick Start

```javascript
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
```

## CSS2DRenderer — HTML Labels & Overlays

Renders HTML elements positioned in 3D space. Always on top of WebGL canvas.

```javascript
// Setup CSS2D renderer
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.top = "0px";
labelRenderer.domElement.style.pointerEvents = "none"; // let clicks pass through
document.body.appendChild(labelRenderer.domElement);

// Create label
const div = document.createElement("div");
div.textContent = "Building A";
div.style.color = "white";
div.style.background = "rgba(0,0,0,0.7)";
div.style.padding = "4px 8px";
div.style.borderRadius = "4px";
div.style.fontSize = "12px";
const label = new CSS2DObject(div);
label.position.set(0, 2, 0);
mesh.add(label);

// Render loop
function animate() {
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
```

### Interactive Labels (clickable)

```javascript
const div = document.createElement("div");
div.textContent = "Click Me";
div.style.cursor = "pointer";
div.addEventListener("click", (e) => {
  e.stopPropagation();
  console.log("Label clicked:", label.position);
});
const label = new CSS2DObject(div);
```

### Tooltip-style Labels

```javascript
// Distance-scaled labels
const updateLabel = () => {
  const dist = camera.position.distanceTo(label.position);
  label.element.style.opacity = dist > 50 ? "0" : "1";
  label.element.style.transform = `scale(${Math.max(0.5, 1 - dist / 100)})`;
};
```

## CSS3DRenderer — 3D Transformed DOM Elements

Elements participate in 3D scene (occlusion-aware, z-sorted).

```javascript
import { CSS3DRenderer, CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.style.position = "absolute";
cssRenderer.domElement.style.top = "0px";
document.body.appendChild(cssRenderer.domElement);

// Embed iframe as 3D plane
const iframe = document.createElement("iframe");
iframe.src = "https://example.com";
iframe.style.width = "400px";
iframe.style.height = "300px";
iframe.style.border = "none";

const screen = new CSS3DObject(iframe);
screen.position.set(0, 2, 0);
screen.rotation.y = Math.PI / 4;
scene.add(screen);
```

## TransformControls — Drag Gizmos

Object manipulation gizmos: translate, rotate, scale.

```javascript
import { TransformControls } from "three/addons/controls/TransformControls.js";

const transformControls = new TransformControls(camera, renderer.domElement);
scene.add(transformControls.getHelper());

// Modes
transformControls.setMode("translate"); // "translate" | "rotate" | "scale"
transformControls.setSize(0.8); // Gizmo handle size
transformControls.setSpace("world"); // "world" | "local"
transformControls.showX = true; // Toggle individual axes

// Attach to object
transformControls.attach(mesh);
transformControls.detach();

// Events
transformControls.addEventListener("dragging-changed", (event) => {
  controls.enabled = !event.value; // Disable OrbitControls while dragging
});

transformControls.addEventListener("objectChange", () => {
  console.log("Transform changed:", mesh.position, mesh.rotation, mesh.scale);
});

// Alt: switch to OrbitControls on key
window.addEventListener("keydown", (e) => {
  if (e.key === "w") transformControls.setMode("translate");
  if (e.key === "e") transformControls.setMode("rotate");
  if (e.key === "r") transformControls.setMode("scale");
});
```

### Snapping

```javascript
transformControls.setTranslationSnap(0.5); // Snap to 0.5m grid
transformControls.setRotationSnap(THREE.MathUtils.degToRad(15)); // Snap to 15°
```

## lil-gui — Parameter Tweaking Panel

Lightweight GUI for real-time parameter adjustment.

```javascript
import GUI from "lil-gui";

const gui = new GUI({ title: "Scene Controls", width: 300 });
gui.close(); // Collapsed by default

// Add controllers
const params = {
  rotationSpeed: 0.5,
  color: "#ff0000",
  wireframe: false,
  metalness: 0.5,
  roughness: 0.5,
  background: scene.background?.getHex() ?? 0x000000,
  resetCamera: () => camera.position.set(4, 3, 6),
};

// Slider
gui.add(params, "rotationSpeed", 0, 2, 0.01).name("旋转速度");

// Color picker
gui.addColor(params, "color").onChange((v) => material.color.set(v));

// Checkbox
gui.add(params, "wireframe").onChange((v) => (material.wireframe = v));

// Range slider
gui.add(params, "metalness", 0, 1).onChange((v) => (material.metalness = v));
gui.add(params, "roughness", 0, 1).onChange((v) => (material.roughness = v));

// Button
gui.add(params, "resetCamera");

// Hierarchical folders
const lightFolder = gui.addFolder("Lighting");
lightFolder.add(ambientLight, "intensity", 0, 2).name("环境光");
lightFolder.add(dirLight, "intensity", 0, 5).name("主光");
lightFolder.add(dirLight.position, "x", -10, 10).name("主光 X");
lightFolder.add(dirLight.position, "y", 0, 20).name("主光 Y");

// Light helpers toggle
const helpers = { showHelpers: false };
gui.add(helpers, "showHelpers").onChange((v) => {
  helper.visible = v;
  shadowHelper.visible = v;
});

// Dispose on scene change
function disposeGUI() {
  gui.destroy();
}
```

## Screenshot / Export

### WebGL Canvas Snapshot

```javascript
// Single frame screenshot
function takeScreenshot() {
  renderer.render(scene, camera);
  const dataURL = renderer.domElement.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = "scene.png";
  link.href = dataURL;
  link.click();
}

// With preserveDrawingBuffer
const renderer = new THREE.WebGLRenderer({
  preserveDrawingBuffer: true, // Required for screenshots
});
```

### Download Scene JSON

```javascript
function downloadJSON(data: unknown, filename = "scene.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
```

## Fullscreen Toggle

```javascript
function toggleFullscreen(element: HTMLElement) {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    element.requestFullscreen();
  }
}
```

## Loading Progress Bar

```javascript
const manager = new THREE.LoadingManager();
let progressBar: HTMLDivElement | null = null;

manager.onStart = () => {
  progressBar = document.createElement("div");
  progressBar.style.cssText =
    "position:fixed;bottom:0;left:0;height:4px;background:#2979ff;transition:width 0.3s;z-index:9999";
  document.body.appendChild(progressBar);
};

manager.onProgress = (_url, loaded, total) => {
  if (progressBar) progressBar.style.width = `${(loaded / total) * 100}%`;
};

manager.onLoad = () => {
  if (progressBar) {
    progressBar.style.transition = "width 0.3s, opacity 0.5s";
    progressBar.style.opacity = "0";
    setTimeout(() => progressBar?.remove(), 500);
  }
};
```

## Common Patterns

### Toolbar Panel (HTML Inline)

```html
<div class="toolbar" style="
  position:absolute; top:10px; left:10px; z-index:10;
  display:flex; gap:6px; padding:6px 10px;
  background:rgba(0,0,0,0.6); border-radius:6px;
">
  <button class="btn" onclick="refresh()">刷新</button>
  <button class="btn" onclick="resetView()">重置</button>
  <button class="btn" onclick="toggleFullscreen(canvas)">全屏</button>
  <button class="btn" onclick="download()">下载</button>
</div>
<style>
  .btn {
    padding:4px 10px; font-size:12px; border:none; border-radius:4px;
    background:rgba(255,255,255,0.15); color:rgba(255,255,255,0.85);
    cursor:pointer;
  }
  .btn:hover { background:rgba(255,255,255,0.25); }
</style>
```

### Object Selection Panel

```javascript
let selectedObject: THREE.Object3D | null = null;
const infoPanel = document.createElement("div");
infoPanel.id = "object-info";
infoPanel.style.cssText = "position:absolute;top:10px;right:10px;padding:8px 12px;background:rgba(0,0,0,0.7);color:white;font-size:12px;border-radius:6px;display:none;z-index:10";
document.body.appendChild(infoPanel);

function selectObject(obj: THREE.Object3D | null) {
  if (selectedObject) {
    if (selectedObject instanceof THREE.Mesh) {
      (selectedObject.material as THREE.MeshStandardMaterial).emissive?.set(0x000000);
    }
  }
  selectedObject = obj;
  if (obj && obj instanceof THREE.Mesh) {
    (obj.material as THREE.MeshStandardMaterial).emissive?.set(0x222222);
    infoPanel.style.display = "block";
    infoPanel.innerHTML = `ID: ${obj.userData.id ?? "N/A"}<br>Type: ${obj.type}<br>Position: ${obj.position.x.toFixed(1)}, ${obj.position.y.toFixed(1)}, ${obj.position.z.toFixed(1)}`;
  } else {
    infoPanel.style.display = "none";
  }
}

// Integrate with raycaster
function onPointerDown(event: PointerEvent) {
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  selectObject(hits[0]?.object ?? null);
}
```

## Performance Tips

1. **CSS2DRenderer**: Use `pointerEvents: "none"` on container so mouse events pass to canvas
2. **lil-gui**: Call `gui.destroy()` when changing scenes to avoid memory leaks
3. **TransformControls**: Disable them when not in use (it adds overhead to the render loop)
4. **Screenshots**: Only set `preserveDrawingBuffer: true` when needed (GPU cost)
5. **Progress bar**: Use CSS animations (not JS-driven) for smoother visuals

## See Also

- `threejs-interaction` — Raycasting, controls, input handling
- `threejs-loaders` — Asset loading with LoadingManager
- `threejs-lighting` — Light helpers and shadow cameras
