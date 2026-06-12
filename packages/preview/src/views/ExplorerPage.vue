<script setup lang="ts">
import A2UIRenderer from "../renderer/render/Renderer.vue";
import { provideA2UI } from "../renderer/render/Provider";
import { ref, watch, onMounted, nextTick, computed, onUnmounted } from "vue";
import treeData from "virtual:test-files";
import { Folder, FileJson, ChevronRight, ChevronLeft, Sun, Moon } from "lucide-vue-next";
import { useTheme } from "../composables/useTheme";

const { createSurface, updateSurface } = provideA2UI();

const modelOptions = ref([
  { label: "gemini-3.0-flash", value: "gemini-3.0-flash" },
  { label: "deepseek-v4-flash", value: "deepseek-v4-flash" },
  { label: "glm-5.1", value: "glm-5.1" },
  { label: "glm-5.1(多轮)", value: "glm-5.1(多轮)" },
]);

const selectedModel = ref<string>("gemini-3.0-flash");
const selectedJsonPath = ref<string>("");
const selectedJsonInfo = ref<any>(null);
const currentContent = ref<any>(null);
const surfaceId = "preview-surface";
const surfaceCreated = ref(false);
const treeRef = ref<any>(null);

// 用于取消过期的 fetch 请求，防止竞态条件
let abortController: AbortController | null = null;

// 侧边栏折叠状态
const sidebarCollapsed = ref(false);

// 主题切换（全局状态）
const { isDark, toggleTheme } = useTheme();

// 当前悬浮节点的 tooltip 内容（keyed by path）
const tooltipMap = ref<Record<string, string>>({});
// 缓存已加载的 md 内容
const mdCache = new Map<string, string>();

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

// 加载 md 文件内容
async function loadMdContent(jsonPath: string): Promise<string> {
  if (mdCache.has(jsonPath)) {
    return mdCache.get(jsonPath)!;
  }

  // 根据 json 路径生成对应的 md 文件路径 ，例如: 2012/2/a.json -> 2012/2/a.md
  const mdPath = jsonPath.replace(/\.json$/, '.md');

  try {
    const res = await fetch(`/api/test-file?path=${encodeURIComponent(mdPath)}`);
    if (res.ok) {
      const text = await res.text();
      mdCache.set(jsonPath, text);
      return text;
    }
  } catch (e) {
    // ignore
  }
  const fallback = '未找到需求描述';
  mdCache.set(jsonPath, fallback);
  return fallback;
}

// 鼠标进入叶子节点时触发加载
async function handleLeafMouseEnter(data: any) {
  const jsonPath = data.path;
  if (tooltipMap.value[jsonPath]) return; // 已加载
  tooltipMap.value[jsonPath] = '加载中...';
  const content = await loadMdContent(jsonPath);
  tooltipMap.value[jsonPath] = content;
}

// 检查目录下是否包含 model 子文件夹
function hasModelSubfolder(dir: any): boolean {
  const modelLabels = modelOptions.value.map((m) => m.value);
  return (dir.children || []).some(
    (child: any) => child.isDirectory && modelLabels.includes(child.label)
  );
}

// 构建树形结构：聚合所有模型的 JSON 文件，标注模型特有文件
const menuTree = computed(() => {
  const modelLabels = modelOptions.value.map((m) => m.value);

  function buildTree(data: any[]): any[] {
    return data
      .map((item: any) => {
        if (!item.isDirectory) return null;

        if (hasModelSubfolder(item)) {
          // 收集所有模型子文件夹中的 JSON 文件
          const fileMap = new Map<string, Set<string>>(); // filename -> set of model names

          for (const child of item.children || []) {
            if (child.isDirectory && modelLabels.includes(child.label)) {
              for (const file of child.children || []) {
                if (!file.isDirectory) {
                  if (!fileMap.has(file.label)) {
                    fileMap.set(file.label, new Set());
                  }
                  fileMap.get(file.label)!.add(child.label);
                }
              }
            }
          }

          if (fileMap.size === 0) return null;

          const jsonFiles = Array.from(fileMap.entries()).map(
            ([filename, models]) => {
              const modelList = Array.from(models);
              return {
                label: filename,
                path: item.path + "/" + filename,
                models: modelList,
              };
            }
          );

          return {
            label: item.label,
            path: item.path,
            children: jsonFiles,
          };
        }

        const children = buildTree(item.children || []);
        if (children.length === 0) return null;
        return {
          label: item.label,
          path: item.path,
          children,
        };
      })
      .filter(Boolean);
  }

  return buildTree(treeData);
});

// 扁平化所有叶子节点（JSON 文件），按顺序排列
const flatLeaves = computed(() => {
  const leaves: any[] = [];
  function collectLeaves(nodes: any[]) {
    for (const node of nodes) {
      if (node.children) {
        collectLeaves(node.children);
      } else {
        leaves.push(node);
      }
    }
  }
  collectLeaves(menuTree.value);
  return leaves;
});

// 当前叶子节点在扁平列表中的索引
const currentLeafIndex = computed(() => {
  return flatLeaves.value.findIndex((leaf) => leaf.path === selectedJsonPath.value);
});

// 通过索引导航到叶子节点
function navigateToLeaf(index: number) {
  if (index < 0 || index >= flatLeaves.value.length) return;
  const leaf = flatLeaves.value[index];
  selectedJsonPath.value = leaf.path;
  selectedJsonInfo.value = leaf;
  loadJsonContent();
  nextTick(() => {
    treeRef.value?.setCurrentKey(leaf.path);
  });
}

function navigatePrev() {
  if (currentLeafIndex.value > 0) {
    navigateToLeaf(currentLeafIndex.value - 1);
  }
}

function navigateNext() {
  if (currentLeafIndex.value < flatLeaves.value.length - 1) {
    navigateToLeaf(currentLeafIndex.value + 1);
  }
}

function getFetchUrl(): string {
  const info = selectedJsonInfo.value;
  if (!info) return "";

  const parts = info.path.split("/");
  const filename = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join("/");

  let model = selectedModel.value;

  const fullPath = parentPath + "/" + model + "/" + filename;
  return `/api/test-file?path=${encodeURIComponent(fullPath)}`;
}

// 通过 API 按需加载单个 JSON 文件
async function loadJsonContent() {
  // 取消上一次未完成的请求，防止竞态条件
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  const signal = abortController.signal;

  const fetchUrl = getFetchUrl();
  try {
    const res = await fetch(fetchUrl, { signal });
    if (!res.ok) {
      console.warn(`[loadJsonContent] 请求失败: ${res.status} ${fetchUrl}`);
      currentContent.value = null;
      return;
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      console.warn(`[loadJsonContent] 返回内容为空: ${fetchUrl}`);
      currentContent.value = null;
      return;
    }
    let content: any;
    try {
      content = JSON.parse(text);
    } catch (parseErr) {
      console.warn(`[loadJsonContent] JSON 解析失败: ${fetchUrl}`, parseErr);
      currentContent.value = null;
      return;
    }
    // 如果请求已被取消，忽略结果
    if (signal.aborted) return;
    currentContent.value = content;
    if (!surfaceCreated.value) {
      surfaceCreated.value = true;
      createSurface(surfaceId, content);
    } else {
      updateSurface(surfaceId, content);
    }
  } catch (err: any) {
    // 忽略 abort 导致的错误
    if (err?.name === 'AbortError') return;
    console.warn(`[loadJsonContent] 加载异常: ${fetchUrl}`, err);
    currentContent.value = null;
  }
}

// 点击叶子节点（JSON文件）
function handleNodeClick(data: any) {
  if (data.children) return;
  selectedJsonPath.value = data.path;
  selectedJsonInfo.value = data;
  loadJsonContent();
}

// 切换模型时重新加载
watch(selectedModel, () => {
  if (selectedJsonPath.value) {
    loadJsonContent();
  }
});

// 获取树中第一个叶子节点
function findFirstLeaf(nodes: any[]): any | null {
  for (const node of nodes) {
    if (node.children) {
      const found = findFirstLeaf(node.children);
      if (found) return found;
    } else {
      return node;
    }
  }
  return null;
}

// 键盘导航：侧边栏收起时，按上下方向键切换页面
function handleKeydown(e: KeyboardEvent) {
  if (!sidebarCollapsed.value) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    navigatePrev();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    navigateNext();
  }
}

onMounted(async () => {
  toggleTheme()
  const firstLeaf = findFirstLeaf(menuTree.value);
  if (firstLeaf) {
    selectedJsonPath.value = firstLeaf.path;
    selectedJsonInfo.value = firstLeaf;
    loadJsonContent();
    nextTick(() => {
      treeRef.value?.setCurrentKey(firstLeaf.path);
    });
  }
  window.addEventListener('keydown', handleKeydown);
});

// 页面销毁时清理资源
onUnmounted(() => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-surface-container-lowest">
    <!-- 悬浮展开按钮（侧边栏收起时显示） -->
    <div v-if="sidebarCollapsed"
      class="fixed left-2 top-1/2 -translate-y-1/2 z-50 w-10 h-10 bg-white rounded-full shadow-lg border border-divider flex items-center justify-center cursor-pointer hover:shadow-xl hover:bg-blue-50 transition-all duration-200 group"
      @click="toggleSidebar">
      <ChevronRight class="w-5 h-5 text-gray-500 group-hover:text-blue-500 transition-colors" />
    </div>

    <!-- 左侧边栏 -->
    <div class="left-content relative flex shrink-0 transition-all duration-300"
      :style="{ width: sidebarCollapsed ? '0px' : '256px', overflow: 'hidden' }">
      <!-- 侧边栏面板 -->
      <div class="flex flex-col border-r border-divider w-64 shrink-0 relative">
        <!-- 主题切换悬浮按钮 -->
        <div 
          class="absolute right-2 top-2 z-9999 w-10 h-10 rounded-full shadow-lg border flex items-center justify-center cursor-pointer hover:shadow-xl transition-all duration-200 group"
          :class="isDark ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-divider hover:bg-blue-50'"
          @click="toggleTheme"
        >
          <Sun v-if="isDark" class="w-5 h-5 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
          <Moon v-else class="w-5 h-5 text-gray-500 group-hover:text-blue-500 transition-colors" />
        </div>
        <!-- 模型选择器 -->
        <div class="p-3 pt-8 border-b border-divider whitespace-nowrap">
          <label class="block text-xs text-gray-500 mb-1.5 font-medium">模型切换</label>
          <el-select v-model="selectedModel" size="small" style="width: 100%" :teleported="true"
            popper-class="model-select-popper">
            <el-option v-for="item in modelOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>

        <!-- 树形菜单 -->
        <div class="flex-1 overflow-y-auto p-2 whitespace-nowrap">
          <el-tree ref="treeRef" :data="menuTree" node-key="path" default-expand-all
            highlight-current :props="{ label: 'label', children: 'children' }" @node-click="handleNodeClick">
            <template #default="{ node, data }">
              <el-tooltip
                v-if="!data.children"
                placement="right"
                :show-after="300"
                :raw-content="false"
                :teleported="true"
                :popper-options="{ strategy: 'fixed' }"
                :popper-style="{ padding: '8px 0px'}"
              >
                <div class="flex items-center gap-1.5"
                  @mouseenter="handleLeafMouseEnter(data)">
                  <FileJson :size="14" class="text-blue-400" />
                  <span class="text-sm truncate"
                    :class="{ 'line-through text-gray-400': data.models && !data.models.includes(selectedModel) }">
                    {{ node.label }}
                  </span>
                </div>
                <template #content>
                  <div class="max-w-[420px] max-h-[60vh] px-3 text-sm overflow-auto">
                    {{tooltipMap[data.path] || '加载中...'}}
                  </div>
                </template>
              </el-tooltip>
              <div v-else class="flex items-center gap-1.5">
                <Folder :size="14" class="text-gray-400" />
                <span class="text-sm truncate">{{ node.label }}</span>
              </div>
            </template>
          </el-tree>
        </div>

        <!-- 底部折叠按钮 -->
        <div
          class="flex items-center justify-center h-8 border-t border-divider cursor-pointer hover:bg-blue-50 transition-colors group shrink-0"
          @click="toggleSidebar">
          <ChevronLeft class="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-transform duration-300" />
        </div>
      </div>
    </div>




    <!-- 右侧内容区 -->
    <div class="flex-1 overflow-auto flex flex-col">
      <!-- 渲染区 -->
      <div v-if="currentContent" class="w-full h-full">
        <A2UIRenderer :surfaceId="surfaceId" />
      </div>
      <div v-else class="flex items-center justify-center h-full text-gray-400 text-sm">
        暂无预览内容
      </div>
    </div>
  </div>
</template>

<style scoped>
.left-content {
  :deep(.el-tree-node__content) {
    height: 32px;
  }
  
  :deep(.el-tree-node.is-current > .el-tree-node__content) {
    background-color: #e8f4fd;
  }
}

.theme-dark {
  .left-content {
    :deep(.el-tree-node.is-current > .el-tree-node__content) {
      background-color:  rgba(0,103,209,0.4);
    }
  }
}
</style>
