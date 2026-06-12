export const MOCK_DELAY_MS = 300

export const MOCK_DOMAINS = [
  { id: 1, name: "ICT", industryId: null, parentId: 0, enableView: true, sort: 1, visibleDeptCodes: null },
  { id: 2, name: "云计算", industryId: null, parentId: 0, enableView: true, sort: 2, visibleDeptCodes: null },
  { id: 3, name: "AI", industryId: null, parentId: 0, enableView: true, sort: 3, visibleDeptCodes: null },
]

export const MOCK_PRODUCT_LINES: Record<number, typeof MOCK_DOMAINS> = {
  1: [
    { id: 11, name: "CANN", industryId: null, parentId: 1, enableView: true, sort: 1, visibleDeptCodes: null },
    { id: 12, name: "网络安全", industryId: null, parentId: 1, enableView: true, sort: 2, visibleDeptCodes: null },
  ],
  2: [
    { id: 21, name: "云服务", industryId: null, parentId: 2, enableView: true, sort: 1, visibleDeptCodes: null },
    { id: 22, name: "云平台", industryId: null, parentId: 2, enableView: true, sort: 2, visibleDeptCodes: null },
  ],
  3: [
    { id: 31, name: "ModelArts", industryId: null, parentId: 3, enableView: true, sort: 1, visibleDeptCodes: null },
    { id: 32, name: "AI引擎", industryId: null, parentId: 3, enableView: true, sort: 2, visibleDeptCodes: null },
  ],
}

export const MOCK_PRODUCTS: Record<number, any[]> = {
  11: [
    { id: 111, name: "PYPTO", parentId: 11, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: false, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false },
    { id: 112, name: "CANN开发套件", parentId: 11, industryId: null, enableView: true, sort: 2, visibleDeptCodes: null, isEnd: true, isSecret: false, isTop: false, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false },
  ],
  12: [
    { id: 121, name: "防火墙", parentId: 12, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 2, commonTeam: 1, commonType: "typeA", count: 5, enableDesignReserve: true, enableProductCommon: false },
  ],
  21: [
    { id: 211, name: "ECS", parentId: 21, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: 10, enableDesignReserve: false, enableProductCommon: true },
    { id: 212, name: "OBS", parentId: 21, industryId: null, enableView: true, sort: 2, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: false, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false },
  ],
  22: [
    { id: 221, name: "Kubernetes", parentId: 22, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 2, commonTeam: 1, commonType: "typeB", count: 8, enableDesignReserve: true, enableProductCommon: true },
  ],
  31: [
    { id: 311, name: "推理服务", parentId: 31, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: 3, enableDesignReserve: false, enableProductCommon: false },
    { id: 312, name: "训练平台", parentId: 31, industryId: null, enableView: true, sort: 2, visibleDeptCodes: null, isEnd: false, isSecret: true, isTop: false, isProductMember: false, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false },
  ],
  32: [
    { id: 321, name: "NLP引擎", parentId: 32, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 2, commonTeam: 1, commonType: "typeC", count: 2, enableDesignReserve: false, enableProductCommon: false },
  ],
}

export const MOCK_VERSIONS: Record<number, any[]> = {
  111: [
    { id: 1111, name: "v2612304", productId: 111, productName: "PYPTO", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 100, userTeamType: null, workflowRoleList: [1, 2] },
    { id: 1112, name: "v2501", productId: 111, productName: "PYPTO", deliveryTypeId: 1, industryId: null, isEnd: true, isTop: false, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 2, spaceId: 101, userTeamType: null, workflowRoleList: [1] },
  ],
  112: [
    { id: 1121, name: "v3.0", productId: 112, productName: "CANN开发套件", deliveryTypeId: 1, industryId: null, isEnd: true, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 102, userTeamType: null, workflowRoleList: [] },
  ],
  121: [
    { id: 1211, name: "v2.1", productId: 121, productName: "防火墙", deliveryTypeId: 2, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 1, sort: 1, spaceId: 200, userTeamType: 1, workflowRoleList: [3] },
  ],
  211: [
    { id: 2111, name: "v5.0", productId: 211, productName: "ECS", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 300, userTeamType: null, workflowRoleList: [1, 2, 3] },
    { id: 2112, name: "v4.0", productId: 211, productName: "ECS", deliveryTypeId: 1, industryId: null, isEnd: true, isTop: false, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 2, spaceId: 301, userTeamType: null, workflowRoleList: [1] },
  ],
  212: [
    { id: 2121, name: "v3.0", productId: 212, productName: "OBS", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 302, userTeamType: null, workflowRoleList: [1, 2] },
  ],
  221: [
    { id: 2211, name: "v1.28", productId: 221, productName: "Kubernetes", deliveryTypeId: 2, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 1, sort: 1, spaceId: 303, userTeamType: 2, workflowRoleList: [2, 3] },
  ],
  311: [
    { id: 3111, name: "v1.0", productId: 311, productName: "推理服务", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 400, userTeamType: null, workflowRoleList: [1] },
    { id: 3112, name: "v0.9", productId: 311, productName: "推理服务", deliveryTypeId: 1, industryId: null, isEnd: true, isTop: false, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 2, spaceId: 401, userTeamType: null, workflowRoleList: [1] },
  ],
  312: [
    { id: 3121, name: "v2.0", productId: 312, productName: "训练平台", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 402, userTeamType: null, workflowRoleList: [2] },
  ],
  321: [
    { id: 3211, name: "v3.5", productId: 321, productName: "NLP引擎", deliveryTypeId: 2, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 1, sort: 1, spaceId: 500, userTeamType: 3, workflowRoleList: [1, 3] },
  ],
}

function allProductsFlat() {
  return Object.values(MOCK_PRODUCTS).flat()
}

export function mockSearchProducts(searchKey: string) {
  if (!searchKey) return []
  const key = searchKey.toLowerCase()
  return allProductsFlat()
    .filter((p) => p.name.toLowerCase().includes(key))
    .map((p) => ({
      productId: p.id,
      name: p.name,
      deliveryTypeId: p.deliveryTypeId,
      isEnd: p.isEnd,
      isProductMember: p.isProductMember,
      isSecret: p.isSecret,
      isTop: p.isTop,
      count: p.count,
      userTeamType: p.userTeamType,
    }))
}

export function mockDomainInfoByProduct(productId: number) {
  const product = allProductsFlat().find((p) => p.id === productId)
  if (!product) return null
  const productLineId = product.parentId
  let domainId: number | undefined
  for (const [dId, lines] of Object.entries(MOCK_PRODUCT_LINES)) {
    if ((lines as any[]).some((l) => l.id === productLineId)) {
      domainId = Number(dId)
      break
    }
  }
  if (!domainId) return null
  const domain = MOCK_DOMAINS.find((d) => d.id === domainId)
  const productLine = MOCK_PRODUCT_LINES[domainId]?.find((l) => l.id === productLineId)
  if (!domain || !productLine) return null
  return { domain, subDomain: productLine, product }
}

export function mockProductTop(productId: number) {
  for (const products of Object.values(MOCK_PRODUCTS)) {
    const product = products.find((p) => p.id === productId)
    if (product) { product.isTop = true; return true }
  }
  return false
}

export function mockProductCancelTop(productId: number) {
  for (const products of Object.values(MOCK_PRODUCTS)) {
    const product = products.find((p) => p.id === productId)
    if (product) { product.isTop = false; return true }
  }
  return false
}

export function mockVersionTop(teamId: number) {
  for (const versions of Object.values(MOCK_VERSIONS)) {
    const version = versions.find((v) => v.baseTeam === teamId)
    if (version) { version.isTop = true; return true }
  }
  return false
}

export function mockVersionCancelTop(teamId: number) {
  for (const versions of Object.values(MOCK_VERSIONS)) {
    const version = versions.find((v) => v.baseTeam === teamId)
    if (version) { version.isTop = false; return true }
  }
  return false
}
