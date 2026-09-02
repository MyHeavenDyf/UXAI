<script setup lang="ts">
import { ref, watch } from "vue"
import type { Component } from "vue"
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus"
import type { DropdownItem } from "../types"
import { getIconComponentRef } from "../Icon/IconBase"
import { svgCacheVersion } from "../../composables/useIconProvider"
import { useTheme } from "../../composables/useTheme"

defineOptions({ name: "DropdownMenuList" })

const props = defineProps<{
  items: DropdownItem[]
  surfaceId?: string
}>()

// ---- 图标解析（同步，追踪 svgCacheVersion 以响应 SVG 到达） ----
const { isDark } = useTheme()
const resolvedIcons = ref<Record<string | number, { component: Component | null; props: Record<string, any> } | null>>({})

watch(
  [() => props.items, svgCacheVersion, isDark],
  ([newItems]) => {
    const map: Record<string | number, any> = {}
    for (const item of (newItems as DropdownItem[])) {
      if (item.icon) {
        map[item.key] = getIconComponentRef(item.icon, {
          size: 14,
          shape: 'lined',
          color: isDark.value ? '#FFFFFF' : '#191919'
        })
      }
    }
    resolvedIcons.value = map
  },
  { immediate: true, deep: true },
)
</script>

<template>
  <ElDropdownMenu>
    <template v-for="item in items" :key="item.key">
      <ElDropdown
        v-if="item.children && item.children.length"
        placement="right-start"
        trigger="hover"
        :hide-on-click="false"
        popper-class="a2ui-dropdown-submenu"
      >
        <li class="el-dropdown-menu__item a2ui-dropdown-submenu__row">
          <component
            v-if="item.icon && resolvedIcons[item.key]"
            class="mr-1"
            :is="resolvedIcons[item.key]?.component"
            v-bind="resolvedIcons[item.key]?.props ?? {}"
          />
          <span class="a2ui-dropdown-submenu__label">{{ item.label }}</span>
          <i class="el-icon el-icon--right a2ui-dropdown-submenu__arrow">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
              <path fill="currentColor"
                d="M831.872 340.864 512 652.672 192.128 340.864a30.59 30.59 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.59 30.59 0 0 0-42.752 0z">
              </path>
            </svg>
          </i>
        </li>
        <template #dropdown>
          <DropdownMenuList :items="item.children" :surface-id="surfaceId" />
        </template>
      </ElDropdown>

      <ElDropdownItem v-else>
        <component
          v-if="item.icon && resolvedIcons[item.key]"
          class="mr-1"
          :is="resolvedIcons[item.key]?.component"
          v-bind="resolvedIcons[item.key]?.props ?? {}"
        />
        <span>{{ item.label }}</span>
      </ElDropdownItem>
    </template>
  </ElDropdownMenu>
</template>

<style lang="less">
.el-dropdown {
  display: flex;
}

.a2ui-dropdown-submenu__row {
  width: 100%;
}
.a2ui-dropdown-submenu__label {
  flex: 1;
}
.a2ui-dropdown-submenu__arrow {
  margin-left: auto;
  transform: rotate(-90deg);
}
</style>
