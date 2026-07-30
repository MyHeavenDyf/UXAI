import { createSignal, Show, For, createMemo, createEffect } from "solid-js"
import type { JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ArchiveTreeSelector, type ProductTreeData, type NestedTreeNode, type TreeNodeItem, type DomainNode, type SubDomainNode, type ProductNode } from "./archive-tree-selector"
import { ArchiveSearchDropdown } from "./archive-search-dropdown"
import { useProjectSelection, type ProjectSelection } from "@/hooks/use-project-selection"
import type { Domain, ProductLine, Product, Version } from "@/network/types"

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
  existingDeliverables: DeliverableItem[]
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
  isProjectArchive: boolean
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
  isProjectArchive: false,
}

let lastUsedSelectionKey: string | null = null

const getSelectionKey = (selection: ProjectSelection | undefined): string => {
  return [
    selection?.domain?.id,
    selection?.productLine?.id,
    selection?.product?.id,
    selection?.version?.id
  ].join('-')
}

const shouldUseProjectSelection = (selection: ProjectSelection | undefined): boolean => {
  const currentKey = getSelectionKey(selection)
  return lastUsedSelectionKey === null || lastUsedSelectionKey !== currentKey
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

const PROJECT_ARCHIVE_ID = -1

const formatFolderList = (nodes: NestedTreeNode[]): NestedTreeNode[] => {
  return nodes.map(node => {
    let children = node.children ? formatFolderList(node.children) : []
    children = children.filter(child => child.permissionFlag)
    let permissionFlag = node.permissionFlag
    if (children.length > 0) {
      permissionFlag = true
    }
    return {
      ...node,
      permissionFlag,
      children
    }
  })
}

const getWorkFlowFolderList = (nodes: NestedTreeNode[]): NestedTreeNode[] => {
  const formatNodes = (items: NestedTreeNode[]): NestedTreeNode[] => {
    return items.map(item => {
      let children = item.children ? formatNodes(item.children) : []
      
      if (item.label === '版本管理') {
        children = children.filter(child => child.label !== '需求管理')
      }
      
      let _hide = !item.permissionFlag
      if (!_hide && children.length > 0) {
        const allChildrenHide = children.every(child => child._hide)
        if (allChildrenHide) _hide = true
      }
      
      return {
        ...item,
        _hide,
        children
      }
    })
  }
  
  const result = formatNodes(nodes)
  result.forEach(node => {
    node.disabled = true
  })
  return result
}

const filterFolderList = (nodes: NestedTreeNode[]): NestedTreeNode[] => {
  const formatted = formatFolderList(nodes).filter(node => node.permissionFlag)
  return getWorkFlowFolderList(formatted)
}

const findFirstSelectable = (nodes: NestedTreeNode[]): NestedTreeNode | null => {
  for (const node of nodes) {
    if (!node._hide && !node.disabled) return node
    if (node.children?.length) {
      const found = findFirstSelectable(node.children)
      if (found) return found
    }
  }
  return null
}

const findFolderById = (nodes: NestedTreeNode[], id: number): NestedTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children?.length) {
      const found = findFolderById(node.children, id)
      if (found) return found
    }
  }
  return null
}

const MOCK_PRODUCT_TEAM: NestedTreeNode[] = [
  {
    id: 339042,
    label: "公共",
    level: 2,
    teamType: 4,
    activityId: 31,
    permissionFlag: true,
    parentId: 339041,
    children: [
      {
        id: 388437,
        label: "分组",
        level: 5,
        teamType: 4,
        activityId: 6,
        permissionFlag: true,
        parentId: 339059,
        baseTeam: 339057,
        children: [
          { id: 388429, label: "分组", level: 5, teamType: 4, activityId: 6, permissionFlag: true, parentId: 388437, baseTeam: 339057, children: [] },
          { id: 388438, label: "分组", level: 5, teamType: 4, activityId: 6, permissionFlag: false, parentId: 388437, baseTeam: 339057, children: [] }
        ]
      }
    ]
  },
  {
    id: 339059,
    label: "版本计划",
    level: 3,
    teamType: 4,
    activityId: 6,
    permissionFlag: true,
    parentId: 339058,
    baseTeam: 339057,
    children: []
  }
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
  showDeliverables?: boolean
}

export function ArchiveDialog(props: Props): JSX.Element {
  const showDeliverablesSection = () => props.showDeliverables !== false
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
  const [showCollisionOverlay, setShowCollisionOverlay] = createSignal(false)
  const [initialized, setInitialized] = createSignal(false)
  const [productTeamList, setProductTeamList] = createSignal<NestedTreeNode[]>(MOCK_PRODUCT_TEAM)
  const [isProjectArchive, setIsProjectArchive] = createSignal(false)
  const [filteredFolderList, setFilteredFolderList] = createSignal<NestedTreeNode[]>([])
  
  const projectSelection = useProjectSelection()
  
  const findMatchingDomain = (domain: Domain | undefined, domains: DomainNode[]) => {
    if (!domain) return null
    return domains.find(d => d.id === domain.id) || null
  }
  
  const findMatchingSubDomain = (productLine: ProductLine | undefined, subDomains: SubDomainNode[]) => {
    if (!productLine) return null
    return subDomains.find(s => s.id === productLine.id) || null
  }
  
  const findMatchingProduct = (product: Product | undefined, products: ProductNode[]) => {
    if (!product) return null
    return products.find(p => p.id === product.id) || null
  }
  
  const findMatchingVersion = (version: Version | undefined, versionList: NestedTreeNode[]) => {
    if (!version) return null
    return versionList.find(v => v.id === version.id) || null
  }
  
  const applyProjectSelectionAsDefault = async (selection: ProjectSelection | undefined, tree: ProductTreeData) => {
    const domain = findMatchingDomain(selection?.domain, tree.domains)
    const subDomain = findMatchingSubDomain(selection?.productLine, tree.subDomains)
    const product = findMatchingProduct(selection?.product, tree.products)
    
    if (product) {
      setSelectedProductId(product.id)
      setSelectedProduct({ name: product.name, commonTeam: product.commonTeam })
      
      const versionTree = await fetchVersionDelivery(product.id)
      if (product.commonTeam) {
        fetchProductTeam(product.commonTeam)
      }
      
      if (versionTree) {
        const version = findMatchingVersion(selection?.version, versionTree)
        if (version) {
          handleVersionSelect(version.id, version)
        } else {
          autoSelectFirstVersionDelivery(versionTree)
        }
      }
    } else {
      autoSelectFirstProduct()
    }
  }

  const restoreFolderSelection = (folders: NestedTreeNode[], savedFolderId: number | null) => {
    if (savedFolderId) {
      const folder = findFolderById(folders, savedFolderId)
      if (folder && !folder._hide && !folder.disabled) {
        setSelectedFolderId(folder.id)
        setSelectedFolder({ label: folder.label })
        if (showDeliverablesSection()) fetchDeliverables(folder.id)
        return
      }
    }
    const first = findFirstSelectable(folders)
    if (first) {
      setSelectedFolderId(first.id)
      setSelectedFolder({ label: first.label })
      if (showDeliverablesSection()) fetchDeliverables(first.id)
    } else {
      setSelectedFolderId(null)
      setSelectedFolder(null)
      setDeliverables([])
    }
  }

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
      const content = data?.content || []
      setVersionDeliveryList(content)
      return content
    } catch (err) {
      console.error("[Archive] Failed to fetch version delivery:", err)
    }
    return null
  }

  const fetchMyTeam = async (): Promise<Array<{ teamId: string; teamName: string }> | null> => {
    if (!isLoggedIn()) return null
    try {
      const res = await fetch(`${getBaseUrl()}/design/sketch.root/workspace/team/getMyTeam`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      const content = data?.content || []
      setMyTeamList(content)
      return content
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
      const content = data?.content || []
      setTeamByVersionList(content)
      return content
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
        `${getBaseUrl()}/main/rest.root/workflow/deliverable/search?teamId=${teamId}&docTypeList=22&searchKeys=&pageNum=1&pageSize=1000`,
        { headers: getAuthHeaders() }
      )
      const data = await res.json()
      const items = data?.content?.data || []
      const transformed = items.map((item: DeliverableItem) => ({
        ...item,
        coverUrl: `${getBaseUrl()}/pipeline${item.coverUrl}`
      }))
      setDeliverables(transformed)
    } catch (err) {
      console.error("[Archive] Failed to fetch deliverables:", err)
    }
  }

  const fetchProductTeam = async (teamId: number): Promise<NestedTreeNode[] | null> => {
    if (!isLoggedIn()) return null
    try {
      const res = await fetch(`${getBaseUrl()}/main/rest.root/workflow/team/getProductTeam?teamId=${teamId}`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      const content = data?.content || []
      setProductTeamList(content)
      return content
    } catch (err) {
      console.error("[Archive] Failed to fetch product team:", err)
    }
    return null
  }

  const getFolderTree = (): NestedTreeNode[] => {
    if (spaceType() === "project") {
      if (isProjectArchive()) {
        return productTeamList()
      }
      return filteredFolderList()
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
    setIsProjectArchive(false)
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
    if (list.length > 0) {
      const first = list[0]
      handleVersionSelect(first.id, first)
    } else {
      setSelectedVersionId(null)
      setSelectedVersion(null)
      setSelectedFolderId(null)
      setSelectedFolder(null)
    }
  }

  const autoSelectFirstFolder = (tree?: NestedTreeNode[]) => {
    const list = tree || getFolderTree()
    const first = findFirstSelectable(list)
    if (first) {
      handleFolderSelect(first.id, first as unknown as TreeNodeItem)
    } else {
      setSelectedFolderId(null)
      setSelectedFolder(null)
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
    lastUsedSelectionKey = null
    const product = item as { name: string; commonTeam?: number }
    setSelectedProductId(id)
    setSelectedProduct({ name: product.name, commonTeam: product.commonTeam })
    setIsProjectArchive(false)
    setFilteredFolderList([])
    
    if (isLoggedIn()) {
      fetchVersionDelivery(id).then((tree) => {
        if (tree) autoSelectFirstVersionDelivery(tree)
        else autoSelectFirstVersionDelivery()
      })
      if (product.commonTeam) {
        fetchProductTeam(product.commonTeam)
      }
    } else {
      autoSelectFirstVersionDelivery()
    }
  }

  const handleVersionSelect = (id: number, item: NestedTreeNode) => {
    if (id === PROJECT_ARCHIVE_ID) {
      setIsProjectArchive(true)
      setSelectedVersionId(id)
      setSelectedVersion({ label: "项目归档", children: productTeamList() })
      setFilteredFolderList([])
      autoSelectFirstFolder(productTeamList())
    } else {
      lastUsedSelectionKey = null
      setIsProjectArchive(false)
      setSelectedVersionId(id)
      
      const filtered = filterFolderList(item.children || [])
      setFilteredFolderList(filtered)
      setSelectedVersion({ label: item.label, children: filtered })
      
      const first = findFirstSelectable(filtered)
      if (first) {
        setSelectedFolderId(first.id)
        setSelectedFolder({ label: first.label })
        if (showDeliverablesSection()) fetchDeliverables(first.id)
      } else {
        setSelectedFolderId(null)
        setSelectedFolder(null)
        setDeliverables([])
      }
    }
  }

  const handleFolderSelect = (id: number, item: TreeNodeItem) => {
    const node = item as { label: string }
    setSelectedFolderId(id)
    setSelectedFolder({ label: node.label })
    if (showDeliverablesSection()) {
      fetchDeliverables(id)
    }
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
            if (product.commonTeam) {
              await fetchProductTeam(product.commonTeam)
            }
            
            if (persistedSelections.isProjectArchive) {
              setIsProjectArchive(true)
              setSelectedVersionId(PROJECT_ARCHIVE_ID)
              setSelectedVersion({ label: "项目归档", children: productTeamList() })
              setFilteredFolderList([])
              restoreFolderSelection(productTeamList(), persistedSelections.folderId)
            } else if (persistedSelections.versionDeliveryId && versionTree) {
              const version = flattenTree(versionTree).find(v => v.id === persistedSelections.versionDeliveryId)
              if (version) {
                setIsProjectArchive(false)
                setSelectedVersionId(version.id)
                
                const filtered = filterFolderList(version.children || [])
                setFilteredFolderList(filtered)
                setSelectedVersion({ label: version.label, children: filtered })
                
                restoreFolderSelection(filtered, persistedSelections.folderId)
              } else {
                autoSelectFirstVersionDelivery(versionTree)
              }
            } else {
              autoSelectFirstVersionDelivery(versionTree || undefined)
            }
          } else {
            if (persistedSelections.isProjectArchive) {
              setIsProjectArchive(true)
              setSelectedVersionId(PROJECT_ARCHIVE_ID)
              setSelectedVersion({ label: "项目归档", children: productTeamList() })
              setFilteredFolderList([])
              restoreFolderSelection(productTeamList(), persistedSelections.folderId)
            } else if (persistedSelections.versionDeliveryId) {
              const version = versionDeliveryList().find(v => v.id === persistedSelections.versionDeliveryId)
              if (version) {
                setIsProjectArchive(false)
                setSelectedVersionId(version.id)
                
                const filtered = filterFolderList(version.children || [])
                setFilteredFolderList(filtered)
                setSelectedVersion({ label: version.label, children: filtered })
                
                restoreFolderSelection(filtered, persistedSelections.folderId)
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
            if (folderTree) {
              restoreFolderSelection(folderTree, persistedSelections.folderId)
            } else {
              autoSelectFirstFolder()
            }
          } else {
            restoreFolderSelection(teamByVersionList(), persistedSelections.folderId)
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
      
      const selection = projectSelection()
      const useProjectSelection = shouldUseProjectSelection(selection)

      if (isLoggedIn()) {
        if (persistedSelections.spaceType === "project") {
          fetchProductTree().then((tree) => {
            if (tree) {
              if (useProjectSelection) {
                applyProjectSelectionAsDefault(selection, tree)
                lastUsedSelectionKey = getSelectionKey(selection)
              } else {
                restoreSelections()
              }
            }
          })
        } else {
          fetchMyTeam().then(() => restoreSelections())
        }
      } else {
        if (useProjectSelection) {
          applyProjectSelectionAsDefault(selection, productTree())
          lastUsedSelectionKey = getSelectionKey(selection)
        } else {
          restoreSelections()
        }
      }
    }
  })

  const executeArchive = (isOverwrite: boolean) => {
    setShowCollisionOverlay(false)

    const matchingDeliverable = deliverables().find(
      d => d.fileName === props.tabTitle.replace(/\.html?$/i, "")
    )
    
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
      existingDeliverableId: isOverwrite ? matchingDeliverable?.id : undefined,
      existingDocId: isOverwrite ? matchingDeliverable?.docId : undefined,
      existingDeliverables: showDeliverablesSection() ? deliverables() : []
    }

    handleClose()
    props.onConfirm(data).catch(err => {
      console.error("[Archive] Failed:", err)
    })
  }

  const handleConfirm = async () => {
    if (!showDeliverablesSection()) {
      await executeArchive(false)
      return
    }
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
      isProjectArchive: isProjectArchive(),
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
      const hasVersions = versionDeliveryList().length > 0
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
              <button type="button" class="archive-close-btn" onClick={handleClose} aria-label="关闭">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>

            <div class="archive-dialog-body">
              <div class="archive-step">
                <div class="archive-step-title">空间</div>
                <div class="archive-step-content">
                  <ArchiveSearchDropdown
                    items={SPACE_OPTIONS.map(opt => ({ id: opt.value, label: opt.label }))}
                    selectedId={spaceType()}
                    selectedLabel={SPACE_OPTIONS.find(opt => opt.value === spaceType())?.label}
                    onSelect={(id) => handleSpaceTypeChange(id as SpaceType)}
                    triggerPlaceholder="请选择空间"
                    maxHeight="250px"
                  />
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
                        items={[
                          ...versionDeliveryList().map(v => ({ id: v.id, label: v.label })),
                          { id: PROJECT_ARCHIVE_ID, label: "项目归档" }
                        ]}
                        selectedId={selectedVersionId()}
                        selectedLabel={selectedVersion()?.label}
                        onSelect={(id) => {
                          if (id === PROJECT_ARCHIVE_ID) {
                            handleVersionSelect(PROJECT_ARCHIVE_ID, {} as NestedTreeNode)
                          } else {
                            const item = versionDeliveryList().find(v => v.id === id)
                            if (item) handleVersionSelect(id as number, item)
                          }
                        }}
                        searchPlaceholder="搜索..."
                        triggerPlaceholder={versionDeliveryList().length === 0 ? "暂无数据" : "请选择版本交付"}
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
                      items={myTeamList()?.map(t => ({ id: t.teamId, label: t.teamName }))}
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

              <Show when={selectedFolderId() !== null && showDeliverablesSection()}>
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
                classList={{ "archive-confirm-btn-disabled": !canConfirm() }}
                disabled={!canConfirm()}
                onClick={handleConfirm}
              >
                确定
              </button>
            </div>

            <Show when={showCollisionOverlay()}>
              <div class="archive-dialog-collision-overlay">
                <div class="archive-dialog-collision-content">
                  <div class="archive-dialog-collision-header">
                    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="none">
                      <path d="M0.731097 23.6902L12.1664 3.88358C12.4005 3.47845 12.682 3.12507 13.011 2.82345C13.2619 2.59354 13.5403 2.39366 13.8463 2.22412C14.1507 2.05542 14.4658 1.92526 14.7916 1.83364C15.1792 1.72482 15.5818 1.67041 15.9998 1.67041C16.7696 1.67041 17.4875 1.85498 18.1535 2.22412C18.8608 2.61628 19.4208 3.16943 19.8332 3.88358L31.2685 23.6902C31.6809 24.4044 31.8798 25.1659 31.8659 25.9747C31.8525 26.736 31.6533 27.45 31.2685 28.1166C30.8837 28.7831 30.3647 29.3126 29.7121 29.7047C29.4122 29.885 29.1 30.0263 28.7755 30.1286C28.35 30.2627 27.903 30.3297 27.4351 30.3297L4.56452 30.3297C4.09668 30.3297 3.65011 30.2627 3.22468 30.1287C2.90046 30.0264 2.58733 29.8849 2.28746 29.7047C1.63484 29.3126 1.11586 28.7831 0.731097 28.1166C0.346331 27.45 0.147112 26.736 0.133998 25.9747C0.119768 25.1659 0.318708 24.4044 0.731097 23.6902ZM15.9998 8.68631C16.6399 8.68631 17.1426 9.18911 17.1426 9.82917L17.1426 19.1623C17.1426 19.8023 16.6399 20.3052 15.9998 20.3052C15.3597 20.3052 14.8569 19.8023 14.8569 19.1623L14.8569 9.82917C14.8569 9.18911 15.3597 8.68631 15.9998 8.68631ZM14.6664 22.9628C14.6664 22.2264 15.2635 21.6294 15.9998 21.6294C16.7361 21.6294 17.3332 22.2264 17.3332 22.9628C17.3332 23.6992 16.7361 24.2961 15.9998 24.2961C15.2635 24.2961 14.6664 23.6992 14.6664 22.9628Z" fill="rgb(252,200,0)" fill-rule="evenodd" />
                    </svg>
                    <h3 class="archive-dialog-collision-title">已存在以下多个同名归档原型</h3>
                  </div>
                  <p class="archive-dialog-collision-name">{props.tabTitle}</p>
                  <div class="archive-dialog-collision-options">
                    <button
                      type="button"
                      class="archive-dialog-collision-option"
                      onClick={() => executeArchive(false)}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                      <span>保留两者</span>
                    </button>
                    <button
                      type="button"
                      class="archive-dialog-collision-option"
                      onClick={() => executeArchive(true)}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                      <span>覆盖这些页面</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    class="archive-dialog-collision-cancel"
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
            width: 452px;
            max-width: 90vw;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 16px 48px 0 rgba(0, 0, 0, 0.16);
            padding: 20px 24px;
            box-sizing: border-box;
            position: relative;
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
            margin-bottom: 16px;
          }
          .archive-dialog-header h3 {
            margin: 0;
            font-size: 16px;
            line-height: 24px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.9);
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
            color: rgba(0, 0, 0, 0.6);
            padding: 0;
            border-radius: 4px;
          }
          .archive-close-btn:hover {
            color: #0a59f7;
          }
          .archive-dialog-body {
            overflow-y: auto;
            flex: 1;
            padding: 0;
          }
          .archive-step {
            margin-bottom: 16px;
          }
          .archive-step:last-child {
            margin-bottom: 0;
          }
          .archive-step-title {
            font-size: 14px;
            line-height: 22px;
            font-weight: 500;
            color: rgba(0, 0, 0, 0.6);
            margin-bottom: 4px;
          }
          .archive-select {
            width: 100%;
            height: 32px;
            padding: 0 12px;
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            font-size: 14px;
            line-height: 22px;
            background: var(--octo-surface-page, #ffffff);
            color: rgba(0, 0, 0, 0.9);
            cursor: pointer;
            box-sizing: border-box;
          }
          .archive-prototype-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 400px;
            overflow-y: auto;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid rgba(0, 0, 0, 0.1);
            box-sizing: border-box;
          }
          .archive-prototype-item {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            height: 40px;
            padding: 0 12px;
            border-radius: 8px;
            box-sizing: border-box;
            transition: background 0.1s;
          }
          .archive-prototype-item:hover {
            background: rgba(0, 0, 0, 0.05);
          }
          .archive-prototype-item-selected {
            background: rgba(10, 89, 247, 0.08);
          }
          .archive-prototype-cover {
            width: 28px;
            height: 28px;
            flex-shrink: 0;
            border-radius: 4px;
            border: 1px solid rgba(0, 0, 0, 0.1);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
          }
          .archive-prototype-cover img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .archive-prototype-name {
            flex: 1;
            font-size: 14px;
            line-height: 22px;
            color: rgba(0, 0, 0, 0.9);
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
            padding: 0;
            margin-top: 16px;
            display: flex;
            justify-content: flex-end;
          }
          .archive-confirm-btn {
            width: 88px;
            height: 32px;
            padding: 0;
            border: none;
            border-radius: 999px;
            font-size: 14px;
            line-height: 22px;
            cursor: pointer;
            background: #0a59f7;
            color: #ffffff;
            font-weight: 500;
            transition: all 0.15s ease;
            box-sizing: border-box;
          }
          .archive-confirm-btn:hover:not(:disabled) {
            background: #0950de;
          }
          .archive-confirm-btn:active:not(:disabled) {
            background: #0a55eb;
          }
          .archive-confirm-btn-disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .archive-dialog-collision-overlay {
            position: absolute;
            top: 56px;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            z-index: 1;
          }
          .archive-dialog-collision-content {
            width: 100%;
            padding: 0 48px;
            box-sizing: border-box;
            transform: translateY(-32px);
          }
          .archive-dialog-collision-header {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            margin-bottom: 4px;
          }
          .archive-dialog-collision-title {
            font-size: 14px;
            line-height: 22px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.9);
            margin: 0;
            text-align: center;
          }
          .archive-dialog-collision-name {
            font-size: 14px;
            line-height: 22px;
            color: rgba(0, 0, 0, 0.6);
            margin: 0 0 24px;
            text-align: center;
          }
          .archive-dialog-collision-options {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 24px;
          }
          .archive-dialog-collision-option {
            display: flex;
            align-items: center;
            gap: 4px;
            height: 40px;
            padding: 0 16px 0 12px;
            border: none;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.05);
            cursor: pointer;
            text-align: left;
          }
          .archive-dialog-collision-option:hover {
            background: rgba(0, 0, 0, 0.08);
          }
          .archive-dialog-collision-option svg {
            flex-shrink: 0;
            color: rgba(0, 0, 0, 0.9);
          }
          .archive-dialog-collision-option span {
            font-size: 14px;
            line-height: 22px;
            color: rgba(0, 0, 0, 0.9);
          }
          .archive-dialog-collision-cancel {
            width: 100%;
            height: 32px;
            padding: 0;
            border: none;
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.05);
            cursor: pointer;
            font-size: 14px;
            line-height: 22px;
            color: rgba(0, 0, 0, 0.9);
          }
          .archive-dialog-collision-cancel:hover {
            background: rgba(0, 0, 0, 0.08);
          }
        `}</style>
      </Portal>
    </Show>
  )
}