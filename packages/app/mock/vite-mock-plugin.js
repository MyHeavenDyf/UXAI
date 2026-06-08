// packages/app/mock/octo-pipeline-mock.ts
var MOCK_DELAY_MS = 300;
var MOCK_DOMAINS = [
  { id: 1, name: "ICT", industryId: null, parentId: 0, enableView: true, sort: 1, visibleDeptCodes: null },
  { id: 2, name: "云计算", industryId: null, parentId: 0, enableView: true, sort: 2, visibleDeptCodes: null },
  { id: 3, name: "AI", industryId: null, parentId: 0, enableView: true, sort: 3, visibleDeptCodes: null }
];
var MOCK_PRODUCT_LINES = {
  1: [
    { id: 11, name: "CANN", industryId: null, parentId: 1, enableView: true, sort: 1, visibleDeptCodes: null },
    { id: 12, name: "网络安全", industryId: null, parentId: 1, enableView: true, sort: 2, visibleDeptCodes: null }
  ],
  2: [
    { id: 21, name: "云服务", industryId: null, parentId: 2, enableView: true, sort: 1, visibleDeptCodes: null },
    { id: 22, name: "云平台", industryId: null, parentId: 2, enableView: true, sort: 2, visibleDeptCodes: null }
  ],
  3: [
    { id: 31, name: "ModelArts", industryId: null, parentId: 3, enableView: true, sort: 1, visibleDeptCodes: null },
    { id: 32, name: "AI引擎", industryId: null, parentId: 3, enableView: true, sort: 2, visibleDeptCodes: null }
  ]
};
var MOCK_PRODUCTS = {
  11: [
    { id: 111, name: "PYPTO", parentId: 11, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: false, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false },
    { id: 112, name: "CANN开发套件", parentId: 11, industryId: null, enableView: true, sort: 2, visibleDeptCodes: null, isEnd: true, isSecret: false, isTop: false, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false }
  ],
  12: [
    { id: 121, name: "防火墙", parentId: 12, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 2, commonTeam: 1, commonType: "typeA", count: 5, enableDesignReserve: true, enableProductCommon: false }
  ],
  21: [
    { id: 211, name: "ECS", parentId: 21, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: 10, enableDesignReserve: false, enableProductCommon: true },
    { id: 212, name: "OBS", parentId: 21, industryId: null, enableView: true, sort: 2, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: false, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false }
  ],
  22: [
    { id: 221, name: "Kubernetes", parentId: 22, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 2, commonTeam: 1, commonType: "typeB", count: 8, enableDesignReserve: true, enableProductCommon: true }
  ],
  31: [
    { id: 311, name: "推理服务", parentId: 31, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: 3, enableDesignReserve: false, enableProductCommon: false },
    { id: 312, name: "训练平台", parentId: 31, industryId: null, enableView: true, sort: 2, visibleDeptCodes: null, isEnd: false, isSecret: true, isTop: false, isProductMember: false, deliveryTypeId: 1, commonTeam: 0, commonType: null, count: null, enableDesignReserve: false, enableProductCommon: false }
  ],
  32: [
    { id: 321, name: "NLP引擎", parentId: 32, industryId: null, enableView: true, sort: 1, visibleDeptCodes: null, isEnd: false, isSecret: false, isTop: true, isProductMember: true, deliveryTypeId: 2, commonTeam: 1, commonType: "typeC", count: 2, enableDesignReserve: false, enableProductCommon: false }
  ]
};
var MOCK_VERSIONS = {
  111: [
    { id: 1111, name: "v2612304", productId: 111, productName: "PYPTO", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 100, userTeamType: null, workflowRoleList: [1, 2] },
    { id: 1112, name: "v2501", productId: 111, productName: "PYPTO", deliveryTypeId: 1, industryId: null, isEnd: true, isTop: false, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 2, spaceId: 101, userTeamType: null, workflowRoleList: [1] }
  ],
  112: [
    { id: 1121, name: "v3.0", productId: 112, productName: "CANN开发套件", deliveryTypeId: 1, industryId: null, isEnd: true, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 102, userTeamType: null, workflowRoleList: [] }
  ],
  121: [
    { id: 1211, name: "v2.1", productId: 121, productName: "防火墙", deliveryTypeId: 2, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 1, sort: 1, spaceId: 200, userTeamType: 1, workflowRoleList: [3] }
  ],
  211: [
    { id: 2111, name: "v5.0", productId: 211, productName: "ECS", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 300, userTeamType: null, workflowRoleList: [1, 2, 3] }
  ],
  311: [
    { id: 3111, name: "v1.0", productId: 311, productName: "推理服务", deliveryTypeId: 1, industryId: null, isEnd: false, isTop: true, modelId: 0, permissionFlag: true, baseTeam: 0, sort: 1, spaceId: 400, userTeamType: null, workflowRoleList: [1] }
  ]
};
function allProductsFlat() {
  return Object.values(MOCK_PRODUCTS).flat();
}
function mockSearchProducts(searchKey) {
  if (!searchKey)
    return [];
  const key = searchKey.toLowerCase();
  return allProductsFlat().filter((p) => p.name.toLowerCase().includes(key)).map((p) => ({
    productId: p.id,
    name: p.name,
    deliveryTypeId: p.deliveryTypeId,
    isEnd: p.isEnd,
    isProductMember: p.isProductMember,
    isSecret: p.isSecret,
    isTop: p.isTop,
    count: p.count,
    userTeamType: p.userTeamType
  }));
}
function mockDomainInfoByProduct(productId) {
  const product = allProductsFlat().find((p) => p.id === productId);
  if (!product)
    return null;
  const productLineId = product.parentId;
  let domainId;
  for (const [dId, lines] of Object.entries(MOCK_PRODUCT_LINES)) {
    if (lines.some((l) => l.id === productLineId)) {
      domainId = Number(dId);
      break;
    }
  }
  if (!domainId)
    return null;
  const domain = MOCK_DOMAINS.find((d) => d.id === domainId);
  const productLine = MOCK_PRODUCT_LINES[domainId]?.find((l) => l.id === productLineId);
  if (!domain || !productLine)
    return null;
  return { domain, subDomain: productLine, product };
}

// packages/app/mock/vite-mock-plugin.ts
var API_PREFIX = "/pipeline/rest.root/workflow";
var mockEnabled = () => process.env.MOCK_API !== "false";
function wrapResponse(content) {
  return JSON.stringify({ data: { errorCode: 0, errorMessage: "", content } });
}
function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx === -1)
    return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}
function viteMockPlugin() {
  return {
    name: "octo:mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!mockEnabled())
          return next();
        if (!req.url?.startsWith(API_PREFIX))
          return next();
        const path = req.url.slice(API_PREFIX.length);
        const query = parseQuery(req.url);
        const route = (() => {
          if (path.startsWith("/domain/getDomains"))
            return "domains";
          if (path.startsWith("/domain/getSubDomains"))
            return "productLines";
          if (path.startsWith("/domain/getDomainInfoByproduct"))
            return "domainInfoByProduct";
          if (path.startsWith("/product/getProducts"))
            return "products";
          if (path.startsWith("/product/search"))
            return "search";
          if (path.startsWith("/version/getversionByProduct"))
            return "versions";
          return null;
        })();
        if (!route)
          return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        const delay = MOCK_DELAY_MS;
        setTimeout(() => {
          let content;
          switch (route) {
            case "domains":
              content = MOCK_DOMAINS;
              break;
            case "productLines":
              content = MOCK_PRODUCT_LINES[Number(query.domainId)] ?? [];
              break;
            case "products":
              content = MOCK_PRODUCTS[Number(query.subDomainId)] ?? [];
              break;
            case "versions":
              content = MOCK_VERSIONS[Number(query.productId)] ?? [];
              break;
            case "search":
              content = mockSearchProducts(query.searchKey ?? "");
              break;
            case "domainInfoByProduct":
              content = mockDomainInfoByProduct(Number(query.productId));
              break;
          }
          res.end(wrapResponse(content));
        }, delay);
      });
    }
  };
}
export {
  viteMockPlugin
};
