export type Domain = {
  id: number
  name: string
  industryId: number | null
  parentId: number
  enableView: boolean
  sort: number
  visibleDeptCodes: string | null
}

export type ProductLine = {
  id: number
  name: string
  industryId: number | null
  parentId: number
  enableView: boolean
  sort: number
  visibleDeptCodes: string | null
}

export type Product = {
  id: number
  name: string
  parentId: number
  industryId: number | null
  enableView: boolean
  sort: number
  visibleDeptCodes: string | null
  isEnd: boolean
  isSecret: boolean
  isTop: boolean
  isProductMember: boolean
  deliveryTypeId: number
  commonTeam: number
  commonType: string | null
  count: number | null
  enableDesignReserve: boolean
  enableProductCommon: boolean
}

export type Version = {
  id: number
  name: string
  productId: number
  productName: string
  deliveryTypeId: number
  industryId: number | null
  isEnd: boolean
  isTop: boolean
  modelId: number
  permissionFlag: boolean
  baseTeam: number
  sort: number
  spaceId: number
  userTeamType: number | null
  workflowRoleList: number[]
}

export type SearchResult = {
  productId: number
  name: string
  deliveryTypeId: number
  isEnd: boolean
  isProductMember: boolean
  isSecret: boolean
  isTop: boolean
  count: number | null
  userTeamType: number | null
}

export type DomainInfoByProduct = {
  domain: Domain
  subDomain: ProductLine
  product: Product
}

export type DeliverableFile = {
  docName: string
  docId: string
  docVersion: string
  docSize: number
}

export type UploadDeliverableBody = {
  typeId: number
  files: DeliverableFile[]
  teamId: number
}
