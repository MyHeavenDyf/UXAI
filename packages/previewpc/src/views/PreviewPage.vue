<script setup lang="ts">
import A2UIRenderer from "../renderer/render/Renderer.vue";
import { provideA2UI } from "../renderer/render/Provider";
import { ref, onMounted, onUnmounted } from "vue";

const { createSurface, updateSurface, store } = provideA2UI();

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
  // 父侧进入编辑态时请求当前 surface 运行时 state（包含用户在非编辑态的交互态，
  // 如已打开的 Modal/Drawer、已切换的 Tab），用于合并进父侧 doc.state，避免首次
  // applyPrototypeModify 触发的 od:a2ui-update 用磁盘旧 state 覆盖 iframe 内存态。
  if (event.data?.type === "od:a2ui-state-request") {
    const surface = store.getSurface(surfaceId) as any
    const state = surface?.dataModel?.getData?.() ?? null
    window.parent.postMessage({ type: "od:a2ui-state-snapshot", state }, "*")
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
      const external = (window as any).__A2UI_DATA__
      if (external) applyA2UIJson(JSON.parse(JSON.stringify(external)))
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