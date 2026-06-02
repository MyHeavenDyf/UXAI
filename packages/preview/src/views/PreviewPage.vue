<script setup lang="ts">
import A2UIRenderer from "../renderer/render/Renderer.vue";
import { provideA2UI } from "../renderer/render/Provider";
import { ref, onMounted } from "vue";

const { createSurface } = provideA2UI();

const currentContent = ref<any>(null);
const surfaceId = "preview-surface";
const loading = ref(true);

onMounted(async () => {
  try {
    const { default: testData } = await import("../jsonStorage/data.json");
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