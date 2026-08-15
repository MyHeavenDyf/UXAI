<script setup lang="ts">
import A2UIRenderer from "../renderer/render/Renderer.vue";
import { provideA2UI } from "../renderer/render/Provider";
import { ref, onMounted, onUnmounted } from "vue";

const { createSurface, updateSurface } = provideA2UI();

const currentContent = ref<any>(null);
const surfaceId = "preview-surface";
const loading = ref(true);
const surfaceCreated = ref(false);

function applyA2UIJson(data: any) {
  if (!data || !data.rootId || !Array.isArray(data.elements)) return
  currentContent.value = data
  if (!surfaceCreated.value) {
    surfaceCreated.value = true
    createSurface(surfaceId, data)
  } else {
    updateSurface(surfaceId, data)
  }
}

function handleMessage(event: MessageEvent) {
  if (event.data?.type === "od:a2ui-update") {
    loading.value = false
    if (event.data.payload === null) {
      currentContent.value = null
    } else if (event.data.payload) {
      applyA2UIJson(event.data.payload)
    }
  }
}

onMounted(async () => {
  window.addEventListener("message", handleMessage)

  if (window.self !== window.top) {
    window.parent.postMessage({ type: "od:a2ui-ready" }, "*")
  }

  try {
    const params = new URLSearchParams(location.search)
    const fetchFile = params.get("fetch")
    if (fetchFile) {
      const res = await fetch("./" + fetchFile, { cache: "no-store" })
      applyA2UIJson(await res.json())
    } else {
      const data = (window as any).__A2UI_DATA__
      if (data) applyA2UIJson(data)
      else {
        const res = await fetch("./data.js", { cache: "no-store" })
        const text = await res.text()
        const noBom = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
        const eq = noBom.indexOf("=")
        const jsonStr = (eq >= 0 ? noBom.slice(eq + 1) : noBom).trim().replace(/;$/, "")
        applyA2UIJson(JSON.parse(jsonStr))
      }
    }
  } catch (err) {
    console.warn("[PreviewPage] 加载默认数据失败:", err);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener("message", handleMessage)
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