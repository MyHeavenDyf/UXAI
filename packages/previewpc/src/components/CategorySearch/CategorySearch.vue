<script setup lang="ts">
import { ref, watch, computed, onMounted, useAttrs } from "vue"
import { ElInput, ElSelect, ElOption } from "element-plus"
import { Search } from "lucide-vue-next"
import type { CategorySearchNode } from "../types"
import type { A2UIComponentProps } from "../../renderer"
import { useA2UIComponent } from "../../renderer/render/hooks"
import "./CategorySearch.less"

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const props = defineProps<A2UIComponentProps<CategorySearchNode>>()
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

// --- Category options ---
const categoryOptions = computed(() => {
  const opts = properties.categoryOptions
  if (Array.isArray(opts)) return opts
  const resolved = resolveValue(opts as any)
  return Array.isArray(resolved) ? resolved : []
})

// --- Category state ---
const initCategory = computed(() => resolveValue(properties.category as any))
const categoryValue = ref(initCategory.value)
watch(() => initCategory.value, (nv) => {
  categoryValue.value = nv
})

function onCategoryChange(val: any) {
  commitActivation('category', val)
}

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
  searchValue.value = item.text
  commitActivation('value', item.text)
  showDropdown.value = false
}

// --- Search trigger ---
function onSearch() {
  sendAction({
    name: "search",
    context: {
      value: searchValue.value,
      category: categoryValue.value,
    }
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    onSearch()
  }
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="category-search"
    :class="[className]"
  >
    <ElSelect
      v-model="categoryValue"
      class="category-search__select"
      @change="onCategoryChange"
    >
      <ElOption
        v-for="item in categoryOptions"
        :key="item.value"
        :label="item.text"
        :value="item.value"
      />
    </ElSelect>
    <div class="category-search__input-wrap">
      <ElInput
        v-model="searchValue"
        :placeholder="placeholder"
        class="category-search__input"
        @change="onInputChange"
        @keydown="onKeydown"
        @focus="onInputFocus"
        @blur="onInputBlur"
        @input="onInputValueChange"
      >
        <template #suffix>
          <span class="category-search__icon" @click="onSearch">
            <Search :size="14" />
          </span>
        </template>
      </ElInput>
      <div v-if="showDropdown" class="category-search__dropdown">
        <template v-if="filteredItems.length">
          <div
            v-for="item in filteredItems"
            :key="item.value"
            class="category-search__dropdown-item"
            @mousedown="selectItem(item)"
          >
            {{ item.text }}
          </div>
        </template>
        <div v-else class="category-search__dropdown-empty">无数据</div>
      </div>
    </div>
  </div>
</template>
