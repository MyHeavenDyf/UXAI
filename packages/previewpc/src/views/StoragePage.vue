<script setup lang="ts">
import A2UIRenderer from "../renderer/render/Renderer.vue";
import { provideA2UI } from "../renderer/render/Provider";
import { ref, onMounted, computed, onUnmounted } from "vue";
import { FileJson, ChevronRight, ChevronLeft, Sun, Moon } from "lucide-vue-next";
import { useTheme } from "../composables/useTheme";

const { createSurface, updateSurface } = provideA2UI();

// 通过 import.meta.glob 自动收集 jsonStorage 下的所有 JSON 文件
// modules: Record<相对路径, () => Promise<{ default: any }>>
const modules = import.meta.glob("../jsonStorage/*.json");

function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aParts = a.match(re) || [];
  const bParts = b.match(re) || [];
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const aIsNum = /^\d+$/.test(aParts[i]);
    const bIsNum = /^\d+$/.test(bParts[i]);
    if (aIsNum && bIsNum) {
      const diff = Number(aParts[i]) - Number(bParts[i]);
      if (diff !== 0) return diff;
    } else {
      const cmp = aParts[i].localeCompare(bParts[i]);
      if (cmp !== 0) return cmp;
    }
  }
  return aParts.length - bParts.length;
}

const storageList = computed(() =>
  Object.keys(modules)
    .map((p) => ({
      label: p.split("/").pop() || p,
      path: p,
      loader: modules[p] as () => Promise<{ default: any }>,
    }))
    .sort((a, b) => naturalCompare(a.label, b.label))
);

const selectedPath = ref<string>("");
const selectedInfo = ref<(typeof storageList.value)[number] | null>(null);
const currentContent = ref<any>(null);
const surfaceId = "preview-surface";
const surfaceCreated = ref(false);
const loading = ref(false);

const sidebarCollapsed = ref(false);

const { isDark, toggleTheme } = useTheme();

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

const currentIndex = computed(() =>
  storageList.value.findIndex((item) => item.path === selectedPath.value)
);

function navigateTo(index: number) {
  if (index < 0 || index >= storageList.value.length) return;
  const item = storageList.value[index];
  selectedPath.value = item.path;
  selectedInfo.value = item;
  loadContent(item);
}

function navigatePrev() {
  if (currentIndex.value > 0) navigateTo(currentIndex.value - 1);
}

function navigateNext() {
  if (currentIndex.value < storageList.value.length - 1)
    navigateTo(currentIndex.value + 1);
}

async function loadContent(item: (typeof storageList.value)[number]) {
  loading.value = true;
  try {
    const mod = await item.loader();
    // 深拷贝避免渲染过程修改源模块对象
    const content = JSON.parse(JSON.stringify(mod.default));
    currentContent.value = content;
    if (!surfaceCreated.value) {
      surfaceCreated.value = true;
      createSurface(surfaceId, content);
    } else {
      updateSurface(surfaceId, content);
    }
  } catch (err) {
    console.warn(`[StoragePage] 加载失败: ${item.path}`, err);
    currentContent.value = null;
  } finally {
    loading.value = false;
  }
}

function handleNodeClick(item: (typeof storageList.value)[number]) {
  selectedPath.value = item.path;
  selectedInfo.value = item;
  loadContent(item);
}

function handleKeydown(e: KeyboardEvent) {
  if (!sidebarCollapsed.value) return;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    navigatePrev();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    navigateNext();
  }
}

onMounted(() => {
  toggleTheme();
  if (storageList.value.length > 0) {
    const first = storageList.value[0];
    selectedPath.value = first.path;
    selectedInfo.value = first;
    loadContent(first);
  }
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
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

        <div class="p-3 pt-8 border-b border-divider whitespace-nowrap">
          <span class="block text-xs text-gray-500 mb-1.5 font-medium">JSON 存储</span>
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700">{{ storageList.length }} 个文件</span>
            <button
              class="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
              title="收起侧边栏"
              @click="toggleSidebar">
              <ChevronLeft class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- 文件列表 -->
        <div class="flex-1 overflow-y-auto p-2 whitespace-nowrap">
          <div
            v-for="item in storageList"
            :key="item.path"
            class="flex items-center gap-1.5 h-8 px-2 rounded cursor-pointer hover:bg-blue-50 transition-colors"
            :class="{ 'bg-blue-50': item.path === selectedPath }"
            @click="handleNodeClick(item)"
          >
            <FileJson :size="14" class="text-blue-400" />
            <span class="text-sm truncate">{{ item.label }}</span>
          </div>
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
      <div v-if="currentContent" class="w-full h-full">
        <A2UIRenderer :surfaceId="surfaceId" />
      </div>
      <div v-else class="flex items-center justify-center h-full text-gray-400 text-sm">
        <span v-if="loading">加载中...</span>
        <span v-else>暂无预览内容</span>
      </div>
    </div>
  </div>
</template>
