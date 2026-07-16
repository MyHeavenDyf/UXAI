import { createSignal, Show, For, createMemo, createEffect } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ArchiveTreeSelector, type ProductTreeData, type NestedTreeNode, type TreeNodeItem } from "./archive-tree-selector"
import { ArchiveSearchDropdown } from "./archive-search-dropdown"

const SPACE_OPTIONS = [
  { value: "project", label: "项目空间" },
  { value: "personal", label: "个人工作台" }
] as const

type SpaceType = "project" | "personal"

export interface ArchiveConfirmData {
  spaceType: SpaceType
  productId?: number
  productName?: string
  commonTeam?: number
  versionDeliveryId?: number
  versionDeliveryName?: string
  folderId: number
  folderName: string
  teamId: number
  isOverwrite: boolean
  existingDeliverableId?: number
  existingDocId?: string
}

interface DeliverableItem {
  fileName: string
  coverUrl: string
  id: number
  docId: string
}

interface PersistedSelections {
  spaceType: SpaceType
  productId: number | null
  productName: string | null
  commonTeam: number | null
  versionDeliveryId: number | null
  versionDeliveryName: string | null
  folderId: number | null
  folderName: string | null
  teamId: string | null
  teamName: string | null
}

let persistedSelections: PersistedSelections = {
  spaceType: "project",
  productId: null,
  productName: null,
  commonTeam: null,
  versionDeliveryId: null,
  versionDeliveryName: null,
  folderId: null,
  folderName: null,
  teamId: null,
  teamName: null,
}

const MOCK_PRODUCT_TREE: ProductTreeData = {
  domains: [
    { id: 377, name: "终端BG", parentId: 0, sort: 0, industryId: 4 },
    { id: 308, name: "质量与流程IT修改该", parentId: 0, sort: 2, industryId: 3 },
    { id: 293, name: "华为云", parentId: 0, sort: 3, industryId: 2 },
    { id: 153, name: "2012实验室", parentId: 0, sort: 7, industryId: 1 },
    { id: 25, name: "ICT", parentId: 0, sort: 13, industryId: 1 }
  ],
  subDomains: [
    { id: 167, name: "UCD与翻译中心", parentId: 153, sort: 0 },
    { id: 297, name: "通用计算服务", parentId: 293, sort: 0 },
    { id: 191, name: "公开", parentId: 25, sort: 3 },
    { id: 455, name: "测试使用修改", parentId: 308, sort: 5 },
    { id: 181, name: "海思", parentId: 153, sort: 6 },
    { id: 27, name: "数通产品线", parentId: 25, sort: 7 },
    { id: 418, name: "测试", parentId: 378, sort: 8 }
  ],
  products: [
    { commonTeam: 191367, deliveryTypeId: 2, id: 89, isSecret: false, name: "Octo Designer", parentId: 167, sort: 0 },
    { commonTeam: 339041, deliveryTypeId: 2, id: 760, isSecret: false, name: "演示&测试使用", parentId: 418, sort: 0 },
    { commonTeam: 375110, deliveryTypeId: 2, id: 831, isSecret: false, name: "测试项目", parentId: 455, sort: 0 },
    { commonTeam: 191524, deliveryTypeId: 2, id: 199, isSecret: false, name: "IP", parentId: 27, sort: 3 },
    { commonTeam: 194461, deliveryTypeId: 2, id: 254, isSecret: false, name: "CCAE", parentId: 191, sort: 4 },
    { commonTeam: 266909, deliveryTypeId: 2, id: 504, isSecret: false, name: "测试项目", parentId: 297, sort: 31 },
    { commonTeam: 311294, deliveryTypeId: 1, id: 661, isSecret: true, name: "CANN", parentId: 181, sort: 35 }
  ]
}

const MOCK_VERSION_DELIVERY: NestedTreeNode[] = [
  {
    id: 339057,
    label: "测试使用",
    level: 1,
    teamType: 1,
    parentId: 0,
    deliveryTypeId: 2,
    children: [
      {
        id: 339058,
        label: "版本管理",
        level: 2,
        teamType: 3,
        parentId: 339057,
        deliveryTypeId: 2,
        children: [
          {
            id: 339062,
            label: "需求管理",
            level: 3,
            teamType: 4,
            parentId: 339058,
            deliveryTypeId: 2,
            baseTeam: 339057
          },
          {
            id: 339059,
            label: "版本计划",
            level: 3,
            teamType: 4,
            parentId: 339058,
            deliveryTypeId: 2,
            baseTeam: 339057,
            children: [
              {
                id: 388437,
                label: "分组",
                level: 5,
                teamType: 4,
                parentId: 339059,
                deliveryTypeId: 2,
                baseTeam: 339057,
                children: [
                  { id: 388429, label: "分组", level: 5, teamType: 4, parentId: 388437, deliveryTypeId: 2, baseTeam: 339057, children: [] },
                  { id: 388438, label: "分组", level: 5, teamType: 4, parentId: 388437, deliveryTypeId: 2, baseTeam: 339057, children: [] }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
]

const MOCK_MY_TEAM = [
  { teamId: "326077", teamName: "demo项目" }
]

const MOCK_TEAM_BY_VERSION: NestedTreeNode[] = [
  { id: 339062, label: "需求管理", level: 3, teamType: 4, parentId: 339058, deliveryTypeId: 2, baseTeam: 339057 },
  {
    id: 339059,
    label: "版本计划",
    level: 3,
    teamType: 4,
    parentId: 339058,
    deliveryTypeId: 2,
    baseTeam: 339057,
    children: [
      {
        id: 388437,
        label: "分组",
        level: 5,
        teamType: 4,
        parentId: 339059,
        deliveryTypeId: 2,
        baseTeam: 339057,
        children: [
          { id: 388429, label: "分组", level: 5, teamType: 4, parentId: 388437, deliveryTypeId: 2, baseTeam: 339057, children: [] },
          { id: 388438, label: "分组", level: 5, teamType: 4, parentId: 388437, deliveryTypeId: 2, baseTeam: 339057, children: [] }
        ]
      }
    ]
  }
]

const MOCK_SEARCH_RESULTS: DeliverableItem[] = [
  { fileName: "在线设计1111", coverUrl: "/workspaces/...", id: 733386, docId: "aaaa" }
]

const getBaseUrl = () => import.meta.env.VITE_OCTO_BASE_URL || ""
const isLoggedIn = () => !!localStorage.getItem("uiplusToken")
const getAuthHeaders = () => ({
})

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (data: ArchiveConfirmData) => Promise<void>
  onResetArchiving?: () => void
  sessionId: string
  filePath: string
  tabTitle: string
}

export function ArchiveDialog(props: Props): JSX.Element {
  const [spaceType, setSpaceType] = createSignal<SpaceType>("project")
  const [productTree, setProductTree] = createSignal<ProductTreeData>(MOCK_PRODUCT_TREE)
  const [selectedProductId, setSelectedProductId] = createSignal<number | null>(null)
  const [selectedProduct, setSelectedProduct] = createSignal<{ name: string; commonTeam?: number } | null>(null)
  const [versionDeliveryList, setVersionDeliveryList] = createSignal<NestedTreeNode[]>(MOCK_VERSION_DELIVERY)
  const [selectedVersionId, setSelectedVersionId] = createSignal<number | null>(null)
  const [selectedVersion, setSelectedVersion] = createSignal<{ label: string; children?: NestedTreeNode[] } | null>(null)
  const [myTeamList, setMyTeamList] = createSignal<Array<{ teamId: string; teamName: string }>>(MOCK_MY_TEAM)
  const [selectedTeamId, setSelectedTeamId] = createSignal<string | null>(null)
  const [selectedTeamName, setSelectedTeamName] = createSignal<string | null>(null)
  const [teamByVersionList, setTeamByVersionList] = createSignal<NestedTreeNode[]>(MOCK_TEAM_BY_VERSION)
  const [selectedFolderId, setSelectedFolderId] = createSignal<number | null>(null)
  const [selectedFolder, setSelectedFolder] = createSignal<{ label: string } | null>(null)
  const [deliverables, setDeliverables] = createSignal<DeliverableItem[]>(MOCK_SEARCH_RESULTS)
  const [loading, setLoading] = createSignal(false)
  const [showCollisionOverlay, setShowCollisionOverlay] = createSignal(false)
  const [initialized, setInitialized] = createSignal(false)

  const flattenTree = (nodes: NestedTreeNode[]): NestedTreeNode[] => {
    const result: NestedTreeNode[] = []
    const traverse = (n: NestedTreeNode[]) => {
      n.forEach(node => {
        result.push(node)
        if (node.children) traverse(node.children)
      })
    }
    traverse(nodes)
    return result
  }

  const fetchProductTree = async (): Promise<ProductTreeData | null> => {
    if (!isLoggedIn()) return null
    try {
      const res = await fetch(`${getBaseUrl()}/main/rest.root/workflow/domain/getProductTreeForPlugin`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data?.content) {
        const tree: ProductTreeData = {
          domains: data.content.domains || [],
          subDomains: data.content.subDomains || [],
          products: data.content.products || []
        }
        setProductTree(tree)
        return tree
      }
    } catch (err) {
      console.error("[Archive] Failed to fetch product tree:", err)
    }
    return null
  }

  const fetchVersionDelivery = async (productId: number): Promise<NestedTreeNode[] | null> => {
    if (!isLoggedIn()) return null
    try {
      const res = await fetch(
        `${getBaseUrl()}/main/rest.root/workflow/team/getTeamListByProductForPlugin?productId=${productId}`,
        { headers: getAuthHeaders() }
      )
      const data = await res.json()
      if (data?.content) {
        setVersionDeliveryList(data.content)
        return data.content
      }
    } catch (err) {
      console.error("[Archive] Failed to fetch version delivery:", err)
    }
    return null
  }

  const fetchMyTeam = async (): Promise<Array<{ teamId: string; teamName: string }> | null> => {
    if (!isLoggedIn()) return null
    try {
      const res = await fetch(`${getBaseUrl()}/design/sketch.root/workspaceteamgetMyTeam`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data?.content) {
        setMyTeamList(data.content)
        return data.content
      }
    } catch (err) {
      console.error("[Archive] Failed to fetch my team:", err)
    }
    return null
  }

  const fetchTeamByVersion = async (teamId: string): Promise<NestedTreeNode[] | null> => {
    if (!isLoggedIn()) return null
    try {
      const res = await fetch(
        `${getBaseUrl()}/pipeline/rest.root/workflow/team/getTeamListByVersion?teamId=${teamId}`,
        { headers: getAuthHeaders() }
      )
      const data = await res.json()
      if (data?.content) {
        setTeamByVersionList(data.content)
        return data.content
      }
    } catch (err) {
      console.error("[Archive] Failed to fetch team by version:", err)
    }
    return null
  }

  const fetchDeliverables = async (teamId: number) => {
    if (!isLoggedIn()) {
      setDeliverables(MOCK_SEARCH_RESULTS)
      return
    }
    try {
      const res = await fetch(
        `${getBaseUrl()}/main/rest.root/workflow/deliverable/search?teamId=${teamId}&docTypeList=22&searchKeys=&pageNum=1&pageSize=6666`,
        { headers: getAuthHeaders() }
      )
      const data = await res.json()
      if (data?.content?.data) {
        setDeliverables(data.content.data)
      }
    } catch (err) {
      console.error("[Archive] Failed to fetch deliverables:", err)
    }
  }

  const getFolderTree = (): NestedTreeNode[] => {
    if (spaceType() === "project") {
      const flat = flattenTree(versionDeliveryList())
      const found = flat.find(n => n.id === selectedVersionId())
      return found?.children || []
    } else {
      return teamByVersionList()
    }
  }

  const clearAllSelections = () => {
    setSelectedProductId(null)
    setSelectedProduct(null)
    setSelectedVersionId(null)
    setSelectedVersion(null)
    setSelectedFolderId(null)
    setSelectedFolder(null)
    setSelectedTeamId(null)
    setSelectedTeamName(null)
    setDeliverables([])
  }

  const autoSelectFirstProduct = async () => {
    const products = productTree().products.sort((a, b) => a.sort - b.sort)
    if (products.length > 0) {
      const first = products[0]
      handleProductSelect(first.id, first as unknown as TreeNodeItem)
    } else {
      setSelectedProductId(null)
      setSelectedProduct(null)
      setSelectedVersionId(null)
      setSelectedVersion(null)
      setSelectedFolderId(null)
      setSelectedFolder(null)
      setDeliverables([])
    }
  }

  const autoSelectFirstVersionDelivery = (tree?: NestedTreeNode[]) => {
    const list = tree || versionDeliveryList()
    const flat = flattenTree(list)
    if (flat.length > 0) {
      const first = flat[0]
      handleVersionSelect(first.id, first)
    } else {
      setSelectedVersionId(null)
      setSelectedVersion(null)
      setSelectedFolderId(null)
      setSelectedFolder(null)
      setDeliverables([])
    }
  }

  const autoSelectFirstFolder = (tree?: NestedTreeNode[]) => {
    const list = tree || getFolderTree()
    const flat = flattenTree(list)
    if (flat.length > 0) {
      const first = flat[0]
      handleFolderSelect(first.id, first as unknown as TreeNodeItem)
    } else {
      setSelectedFolderId(null)
      setSelectedFolder(null)
      setDeliverables([])
    }
  }

  const autoSelectFirstTeam = async () => {
    const teams = myTeamList()
    if (teams.length > 0) {
      const first = teams[0]
      handleTeamSelect(first.teamId, { label: first.teamName })
    } else {
      setSelectedTeamId(null)
      setSelectedTeamName(null)
      setSelectedFolderId(null)
      setSelectedFolder(null)
      setDeliverables([])
    }
  }

  const handleSpaceTypeChange = (newType: SpaceType) => {
    setSpaceType(newType)
    clearAllSelections()
    
    if (isLoggedIn()) {
      if (newType === "project") {
        fetchProductTree().then(() => autoSelectFirstProduct())
      } else {
        fetchMyTeam().then(() => autoSelectFirstTeam())
      }
    } else {
      if (newType === "project") {
        autoSelectFirstProduct()
      } else {
        autoSelectFirstTeam()
      }
    }
  }

  const handleProductSelect = (id: number, item: TreeNodeItem) => {
    const product = item as { name: string; commonTeam?: number }
    setSelectedProductId(id)
    setSelectedProduct({ name: product.name, commonTeam: product.commonTeam })
    
    if (isLoggedIn()) {
      fetchVersionDelivery(id).then((tree) => {
        if (tree) autoSelectFirstVersionDelivery(tree)
        else autoSelectFirstVersionDelivery()
      })
    } else {
      autoSelectFirstVersionDelivery()
    }
  }

  const handleVersionSelect = (id: number, item: NestedTreeNode) => {
    setSelectedVersionId(id)
    setSelectedVersion({ label: item.label, children: item.children })
    
    const folders = item.children || []
    autoSelectFirstFolder(folders)
  }

  const handleFolderSelect = (id: number, item: TreeNodeItem) => {
    const node = item as { label: string }
    setSelectedFolderId(id)
    setSelectedFolder({ label: node.label })
    fetchDeliverables(id)
  }

  const handleTeamSelect = (id: string, item: { label: string }) => {
    setSelectedTeamId(id)
    setSelectedTeamName(item.label)
    
    if (isLoggedIn()) {
      fetchTeamByVersion(id).then((tree) => {
        if (tree) autoSelectFirstFolder(tree)
        else autoSelectFirstFolder()
      })
    } else {
      autoSelectFirstFolder()
    }
  }

  const restoreSelections = async () => {
    setSpaceType(persistedSelections.spaceType)
    
    if (persistedSelections.spaceType === "project") {
      if (persistedSelections.productId) {
        const product = productTree().products.find(p => p.id === persistedSelections.productId)
        if (product) {
          setSelectedProductId(product.id)
          setSelectedProduct({ name: product.name, commonTeam: product.commonTeam })
          
          if (isLoggedIn()) {
            const versionTree = await fetchVersionDelivery(product.id)
            if (versionTree && persistedSelections.versionDeliveryId) {
              const version = flattenTree(versionTree).find(v => v.id === persistedSelections.versionDeliveryId)
              if (version) {
                setSelectedVersionId(version.id)
                setSelectedVersion({ label: version.label, children: version.children })
                
                if (persistedSelections.folderId) {
                  const folder = flattenTree(version.children || []).find(f => f.id === persistedSelections.folderId)
                  if (folder) {
                    setSelectedFolderId(folder.id)
                    setSelectedFolder({ label: folder.label })
                    fetchDeliverables(folder.id)
                  } else {
                    autoSelectFirstFolder(version.children)
                  }
                } else {
                  autoSelectFirstFolder(version.children)
                }
              } else {
                autoSelectFirstVersionDelivery(versionTree)
              }
            } else {
              autoSelectFirstVersionDelivery(versionTree || undefined)
            }
          } else {
            if (persistedSelections.versionDeliveryId) {
              const version = flattenTree(versionDeliveryList()).find(v => v.id === persistedSelections.versionDeliveryId)
              if (version) {
                setSelectedVersionId(version.id)
                setSelectedVersion({ label: version.label, children: version.children })
                if (persistedSelections.folderId) {
                  const folder = flattenTree(version.children || []).find(f => f.id === persistedSelections.folderId)
                  if (folder) {
                    setSelectedFolderId(folder.id)
                    setSelectedFolder({ label: folder.label })
                    fetchDeliverables(folder.id)
                  } else {
                    autoSelectFirstFolder(version.children)
                  }
                } else {
                  autoSelectFirstFolder(version.children)
                }
              } else {
                autoSelectFirstVersionDelivery()
              }
            } else {
              autoSelectFirstVersionDelivery()
            }
          }
        } else {
          autoSelectFirstProduct()
        }
      } else {
        autoSelectFirstProduct()
      }
    } else {
      if (persistedSelections.teamId) {
        const team = myTeamList().find(t => t.teamId === persistedSelections.teamId)
        if (team) {
          setSelectedTeamId(team.teamId)
          setSelectedTeamName(team.teamName)
          
          if (isLoggedIn()) {
            const folderTree = await fetchTeamByVersion(team.teamId)
            if (folderTree && persistedSelections.folderId) {
              const folder = flattenTree(folderTree).find(f => f.id === persistedSelections.folderId)
              if (folder) {
                setSelectedFolderId(folder.id)
                setSelectedFolder({ label: folder.label })
                fetchDeliverables(folder.id)
              } else {
                autoSelectFirstFolder(folderTree)
              }
            } else {
              autoSelectFirstFolder(folderTree || undefined)
            }
          } else {
            if (persistedSelections.folderId) {
              const folder = flattenTree(teamByVersionList()).find(f => f.id === persistedSelections.folderId)
              if (folder) {
                setSelectedFolderId(folder.id)
                setSelectedFolder({ label: folder.label })
                fetchDeliverables(folder.id)
              } else {
                autoSelectFirstFolder()
              }
            } else {
              autoSelectFirstFolder()
            }
          }
        } else {
          autoSelectFirstTeam()
        }
      } else {
        autoSelectFirstTeam()
      }
    }
  }

  createEffect(() => {
    if (props.open && !initialized()) {
      setInitialized(true)
      
      if (isLoggedIn()) {
        if (persistedSelections.spaceType === "project") {
          fetchProductTree().then(() => restoreSelections())
        } else {
          fetchMyTeam().then(() => restoreSelections())
        }
      } else {
        restoreSelections()
      }
    }
  })

  const executeArchive = async (isOverwrite: boolean) => {
    setLoading(true)
    setShowCollisionOverlay(false)

    try {
      const data: ArchiveConfirmData = {
        spaceType: spaceType(),
        productId: spaceType() === "project" ? selectedProductId() || undefined : undefined,
        productName: spaceType() === "project" ? selectedProduct()?.name : undefined,
        commonTeam: spaceType() === "project" ? selectedProduct()?.commonTeam : undefined,
        versionDeliveryId: spaceType() === "project" ? selectedVersionId() || undefined : undefined,
        versionDeliveryName: spaceType() === "project" ? selectedVersion()?.label : undefined,
        folderId: selectedFolderId() || 0,
        folderName: selectedFolder()?.label || "",
        teamId: selectedFolderId() || 0,
        isOverwrite,
        existingDeliverableId: isOverwrite ? deliverables()[0]?.id : undefined,
        existingDocId: isOverwrite ? deliverables()[0]?.docId : undefined
      }

      await props.onConfirm(data)
      handleClose()
    } catch (err) {
      console.error("[Archive] Failed:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (hasMatchingDeliverable()) {
      setShowCollisionOverlay(true)
      return
    }
    await executeArchive(false)
  }

  const handleClose = () => {
    persistedSelections = {
      spaceType: spaceType(),
      productId: selectedProductId(),
      productName: selectedProduct()?.name || null,
      commonTeam: selectedProduct()?.commonTeam || null,
      versionDeliveryId: selectedVersionId(),
      versionDeliveryName: selectedVersion()?.label || null,
      folderId: selectedFolderId(),
      folderName: selectedFolder()?.label || null,
      teamId: selectedTeamId(),
      teamName: selectedTeamName(),
    }
    setInitialized(false)
    props.onResetArchiving?.()
    props.onClose()
  }

  const hasMatchingDeliverable = createMemo(() => {
    const fileName = props.tabTitle.replace(/\.html?$/i, "")
    return deliverables().some(d => d.fileName === fileName)
  })

  const hasEmptyData = createMemo(() => {
    if (spaceType() === "project") {
      const hasProducts = productTree().products.length > 0
      const hasVersions = flattenTree(versionDeliveryList()).length > 0
      const hasFolders = selectedVersionId() !== null && flattenTree(getFolderTree()).length > 0
      return !hasProducts || !hasVersions || !hasFolders
    } else {
      const hasTeams = myTeamList().length > 0
      const hasFolders = flattenTree(teamByVersionList()).length > 0
      return !hasTeams || !hasFolders
    }
  })

  const canConfirm = createMemo(() => {
    if (hasEmptyData()) return false
    
    if (spaceType() === "project") {
      return selectedProductId() !== null && selectedVersionId() !== null && selectedFolderId() !== null
    } else {
      return selectedTeamId() !== null && selectedFolderId() !== null
    }
  })

  return (
    <Show when={props.open}>
      <Portal mount={document.body}>
        <div class="archive-dialog-overlay" onClick={handleClose}>
          <div class="archive-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="archive-dialog-header">
              <h3>归档</h3>
              <button type="button" class="archive-close-btn" onClick={handleClose}>
                ✕
              </button>
            </div>

            <div class="archive-dialog-body">
              <div class="archive-step">
                <div class="archive-step-title">空间</div>
                <div class="archive-step-content">
                  <select
                    value={spaceType()}
                    onChange={(e) => handleSpaceTypeChange(e.currentTarget.value as SpaceType)}
                    class="archive-select"
                  >
                    <For each={SPACE_OPTIONS}>
                      {opt => <option value={opt.value}>{opt.label}</option>}
                    </For>
                  </select>
                </div>
              </div>

              <Show when={spaceType() === "project"}>
                <div class="archive-step">
                  <div class="archive-step-title">产品</div>
                  <div class="archive-step-content">
                    <ArchiveTreeSelector
                      data={productTree()}
                      leafOnly={true}
                      selectedId={selectedProductId()}
                      selectedLabel={selectedProduct()?.name}
                      onSelect={handleProductSelect}
                      searchPlaceholder="搜索产品..."
                      triggerPlaceholder={productTree().products.length === 0 ? "暂无数据" : "请选择产品"}
                      maxHeight="250px"
                    />
                  </div>
                </div>

                <Show when={selectedProductId() !== null}>
                  <div class="archive-step">
                    <div class="archive-step-title">版本交付</div>
                    <div class="archive-step-content">
                      <ArchiveSearchDropdown
                        items={flattenTree(versionDeliveryList()).map(v => ({ id: v.id, label: v.label }))}
                        selectedId={selectedVersionId()}
                        selectedLabel={selectedVersion()?.label}
                        onSelect={(id) => {
                          const item = flattenTree(versionDeliveryList()).find(v => v.id === id)
                          if (item) handleVersionSelect(id as number, item)
                        }}
                        searchPlaceholder="搜索..."
                        triggerPlaceholder={flattenTree(versionDeliveryList()).length === 0 ? "暂无数据" : "请选择版本交付"}
                        maxHeight="250px"
                      />
                    </div>
                  </div>

                  <Show when={selectedVersionId() !== null}>
                    <div class="archive-step">
                      <div class="archive-step-title">文件夹</div>
                      <div class="archive-step-content">
                        <ArchiveTreeSelector
                          data={getFolderTree()}
                          leafOnly={false}
                          selectedId={selectedFolderId()}
                          selectedLabel={selectedFolder()?.label}
                          onSelect={handleFolderSelect}
                          searchPlaceholder="搜索文件夹..."
                          triggerPlaceholder={getFolderTree().length === 0 ? "暂无数据" : "请选择文件夹"}
                          maxHeight="250px"
                        />
                      </div>
                    </div>
                  </Show>
                </Show>
              </Show>

              <Show when={spaceType() === "personal"}>
                <div class="archive-step">
                  <div class="archive-step-title">项目</div>
                  <div class="archive-step-content">
                    <ArchiveSearchDropdown
                      items={myTeamList().map(t => ({ id: t.teamId, label: t.teamName }))}
                      selectedId={selectedTeamId()}
                      selectedLabel={selectedTeamName() || undefined}
                      onSelect={(id, item) => handleTeamSelect(id as string, item)}
                      searchPlaceholder="搜索..."
                      triggerPlaceholder={myTeamList().length === 0 ? "暂无数据" : "请选择项目"}
                      maxHeight="250px"
                    />
                  </div>
                </div>

                <Show when={selectedTeamId() !== null}>
                  <div class="archive-step">
                    <div class="archive-step-title">文件夹</div>
                    <div class="archive-step-content">
                      <ArchiveTreeSelector
                        data={teamByVersionList()}
                        leafOnly={false}
                        selectedId={selectedFolderId()}
                        selectedLabel={selectedFolder()?.label}
                        onSelect={handleFolderSelect}
                        searchPlaceholder="搜索文件夹..."
                        triggerPlaceholder={teamByVersionList().length === 0 ? "暂无数据" : "请选择文件夹"}
                        maxHeight="250px"
                      />
                    </div>
                  </div>
                </Show>
              </Show>

              <Show when={selectedFolderId() !== null}>
                <div class="archive-step">
                  <div class="archive-step-title">归档原型</div>
                  <div class="archive-step-content">
                    <div class="archive-prototype-list">
                      <For each={deliverables()}>
                        {item => (
                          <div class="archive-prototype-item">
                            <div class="archive-prototype-cover">
                              <img src={item.coverUrl || ""} alt={item.fileName} />
                            </div>
                            <div class="archive-prototype-name">{item.fileName}</div>
                          </div>
                        )}
                      </For>
                      <Show when={deliverables().length === 0}>
                        <div class="archive-prototype-empty">暂无归档原型</div>
                      </Show>
                    </div>
                  </div>
                </div>
              </Show>
            </div>

            <div class="archive-dialog-footer">
              <button
                type="button"
                class="archive-confirm-btn"
                classList={{ "archive-confirm-btn-disabled": !canConfirm() || loading() }}
                disabled={!canConfirm() || loading()}
                onClick={handleConfirm}
              >
                {loading() ? "处理中..." : "确定"}
              </button>
            </div>

            <Show when={showCollisionOverlay()}>
              <div class="archive-collision-overlay">
                <div class="archive-collision-content">
                  <p class="archive-collision-title">已存在以下多个同名归档原型</p>
                  <p class="archive-collision-name">{props.tabTitle}</p>
                  <div class="archive-collision-options">
                    <button
                      type="button"
                      class="archive-collision-btn archive-collision-overwrite"
                      onClick={() => executeArchive(true)}
                    >
                      覆盖这些页面
                    </button>
                    <button
                      type="button"
                      class="archive-collision-btn archive-collision-keep"
                      onClick={() => executeArchive(false)}
                    >
                      保留两者
                    </button>
                    <button
                      type="button"
                      class="archive-collision-btn archive-collision-skip"
                      onClick={() => setShowCollisionOverlay(false)}
                    >
                      跳过
                    </button>
                  </div>
                  <button
                    type="button"
                    class="archive-collision-cancel"
                    onClick={() => setShowCollisionOverlay(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
        <style>{`
          .archive-dialog-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }
          .archive-dialog {
            background: #ffffff;
            border-radius: 12px;
            width: 560px;
            max-width: 90vw;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: var(--octo-shadow-lg);
            animation: dialog-slide-in 0.2s ease-out;
          }
          @keyframes dialog-slide-in {
            from {
              opacity: 0;
              transform: translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .archive-dialog-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--octo-border-default);
          }
          .archive-dialog-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--octo-text-primary);
          }
          .archive-close-btn {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: transparent;
            cursor: pointer;
            color: var(--octo-text-secondary);
            font-size: 16px;
            border-radius: 4px;
          }
          .archive-close-btn:hover {
            background: var(--octo-surface-hover);
          }
          .archive-dialog-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
          }
          .archive-step {
            margin-bottom: 20px;
          }
          .archive-step:last-child {
            margin-bottom: 0;
          }
          .archive-step-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--octo-text-secondary);
            margin-bottom: 8px;
          }
          .archive-select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--octo-border-default);
            border-radius: 6px;
            font-size: 14px;
            background: var(--octo-surface-default);
            color: var(--octo-text-primary);
            cursor: pointer;
          }
          .archive-prototype-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 400px;
            overflow-y: auto;
            padding: 4px;
          }
          .archive-prototype-item {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border: 1px solid var(--octo-border-default);
            border-radius: 6px;
            background: var(--octo-surface-default);
          }
          .archive-prototype-cover {
            width: 80px;
            height: 45px;
            flex-shrink: 0;
            background: var(--octo-surface-subtle);
            border-radius: 4px;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .archive-prototype-cover img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .archive-prototype-name {
            flex: 1;
            font-size: 13px;
            color: var(--octo-text-primary);
            text-align: left;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .archive-prototype-empty {
            text-align: center;
            padding: 20px;
            color: var(--octo-text-secondary);
            font-size: 13px;
          }
          .archive-dialog-footer {
            padding: 16px 20px;
            border-top: 1px solid var(--octo-border-default);
            display: flex;
            justify-content: flex-end;
          }
          .archive-confirm-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            background: var(--octo-accent, #2563eb);
            color: #ffffff;
            font-weight: 500;
            transition: all 0.15s ease;
          }
          .archive-confirm-btn:hover:not(:disabled) {
            background: var(--octo-accent-hover, #1d4ed8);
          }
          .archive-confirm-btn-disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .archive-collision-overlay {
            position: absolute;
            inset: 0;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            z-index: 1;
          }
          .archive-collision-content {
            text-align: center;
            padding: 20px;
          }
          .archive-collision-title {
            font-size: 14px;
            color: var(--octo-text-primary);
            margin: 0 0 8px;
          }
          .archive-collision-name {
            font-size: 14px;
            font-weight: 500;
            color: var(--octo-text-primary);
            margin: 0 0 20px;
          }
          .archive-collision-options {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
          }
          .archive-collision-btn {
            padding: 10px 16px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            background: #F9F9F9;
            color: var(--octo-text-primary);
          }
          .archive-collision-btn:hover {
            opacity: 0.9;
          }
          .archive-collision-cancel {
            padding: 8px 24px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            background: transparent;
            color: var(--octo-text-secondary);
          }
        `}</style>
      </Portal>
    </Show>
  )
}