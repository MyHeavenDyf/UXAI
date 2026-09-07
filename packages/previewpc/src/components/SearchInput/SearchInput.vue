<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import { ElInput } from "element-plus"
import { Search } from "lucide-vue-next"
import type { SearchInputNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./SearchInput.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const props = defineProps<A2UIComponentProps<SearchInputNode>>()
const { node, surfaceId } = props
const { properties } = props.node
const { resolveValue, commitActivation, sendAction } = useA2UIComponent(node, surfaceId)

// --- DOM attribute transfer ---
const wrapperRef = ref<HTMLElement>()
onMounted(() => {
  if (wrapperRef.value) {
    if (attrs['id'] != null)
      wrapperRef.value.setAttribute('id', String(attrs['id']))
    if (attrs['dom-picker-component'] != null)
      wrapperRef.value.setAttribute('dom-picker-component', String(attrs['dom-picker-component']))
    if (attrs['data-element-props'] != null)
      wrapperRef.value.setAttribute('data-element-props', String(attrs['data-element-props']))
  }
})

// --- Resolved props ---
const className = computed(() => properties.className || "")
const placeholder = computed(() => (resolveValue(properties.placeholder) as string) || "")
const disabled = computed(() => (resolveValue(properties.disabled) as boolean) || false)

// --- Search value state ---
const initVal = computed(() => (resolveValue(properties.value) as string) ?? "")
const searchValue = ref(initVal.value)
watch(() => initVal.value, (nv) => {
  searchValue.value = nv
})

function onInputChange(val: string) {
  commitActivation('value', val)
}

// --- Pop items (suggestion list) ---
const popItems = computed(() => {
  const items = properties.popItems
  if (Array.isArray(items)) return items
  const resolved = resolveValue(items as any)
  return Array.isArray(resolved) ? resolved : []
})

const filteredItems = computed(() => {
  const keyword = searchValue.value?.trim().toLowerCase()
  if (!keyword || !popItems.value.length) return []
  return popItems.value.filter(item =>
    item.text?.toLowerCase().includes(keyword)
  )
})

const showDropdown = ref(false)

function onInputFocus() {
  if (searchValue.value?.trim()) {
    showDropdown.value = true
  }
}

function onInputBlur() {
  // Delay to allow click on dropdown item
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}

function onInputValueChange() {
  if (searchValue.value?.trim()) {
    showDropdown.value = true
  } else {
    showDropdown.value = false
  }
}

function selectItem(item: any) {
  if (item?.disabled) return
  searchValue.value = item.text
  commitActivation('value', item.text)
  showDropdown.value = false
}

// --- Search trigger ---
function onSearch() {
  if (disabled.value) return
  sendAction({
    name: "search",
    context: {
      value: searchValue.value,
    }
  })
}

function onKeydown(e: KeyboardEvent | Event) {
  if ((e as KeyboardEvent).key === "Enter") {
    onSearch()
  }
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="search-input"
    :class="[className, { 'search-input--disabled': disabled }]"
  >
    <div class="search-input__input-wrap">
      <ElInput
        v-model="searchValue"
        :placeholder="placeholder"
        :disabled="disabled"
        class="search-input__input"
        @change="onInputChange"
        @keydown="onKeydown"
        @focus="onInputFocus"
        @blur="onInputBlur"
        @input="onInputValueChange"
      >
        <template #suffix>
          <span class="search-input__icon" @click="onSearch">
            <Search :size="14" />
          </span>
        </template>
      </ElInput>
      <div v-if="showDropdown" class="search-input__dropdown">
        <template v-if="filteredItems.length">
          <div
            v-for="item in filteredItems"
            :key="item.value"
            class="search-input__dropdown-item"
            :class="{ 'is-disabled': item.disabled }"
            @mousedown="selectItem(item)"
          >
            {{ item.text }}
          </div>
        </template>
        <div v-else class="search-input__dropdown-empty">无数据</div>
      </div>
    </div>
  </div>
</template>
