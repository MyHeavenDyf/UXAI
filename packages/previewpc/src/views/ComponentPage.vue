<script setup lang="ts">
import A2UIRenderer from "../renderer/render/Renderer.vue";
import { provideA2UI } from "../renderer/render/Provider.ts";
import { ref, onMounted } from "vue";
import { Sun, Moon } from "lucide-vue-next";
import { useTheme } from "../composables/useTheme.ts";

const { createSurface } = provideA2UI();

const { isDark, toggleTheme } = useTheme();

const currentContent = ref<any>(null);
const surfaceId = "preview-surface";
const loading = ref(true);

onMounted(async () => {
  try {
    const { default: testData } = await import("../jsonStorage/componentShowcase.json");
    currentContent.value = JSON.parse(JSON.stringify(testData));
    createSurface(surfaceId, currentContent.value);
  } catch (err) {
    console.warn("[PreviewPage] 加载 data.json 失败:", err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="flex flex-col h-screen overflow-auto bg-gray-50">
    <!-- 主题切换悬浮按钮（右上角） -->
    <div 
      class="absolute right-2 top-2 z-50 w-10 h-10 rounded-full shadow-lg border flex items-center justify-center cursor-pointer hover:shadow-xl transition-all duration-200 group"
      :class="isDark ? 'bg-gray-800 border-gray-600 hover:bg-gray-700' : 'bg-white border-divider hover:bg-blue-50'"
      @click="toggleTheme"
    >
      <Sun v-if="isDark" class="w-5 h-5 text-yellow-400 group-hover:text-yellow-300 transition-colors" />
      <Moon v-else class="w-5 h-5 text-gray-500 group-hover:text-blue-500 transition-colors" />
    </div>

    <!-- 渲染区 -->
    <div v-if="currentContent" class="w-full h-full">
      <A2UIRenderer :surfaceId="surfaceId" />
    </div>
    <div v-else class="flex items-center justify-center h-full text-gray-400 text-sm">
      <span v-if="loading">加载中...</span>
      <span v-else>暂无预览内容</span>
    </div>
  </div>
</template>