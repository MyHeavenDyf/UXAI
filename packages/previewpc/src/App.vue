<script setup lang="ts">
import { provideIconProvider } from './composables/useIconProvider'

// 提供图标系统状态给所有子孙组件
provideIconProvider()
</script>

<template>
  <router-view />
</template>