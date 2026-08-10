import { createRouter, createWebHashHistory } from "vue-router";
import PreviewPage from "../views/PreviewPage.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "Preview",
      component: PreviewPage,
    },
    {
      path: "/explorer",
      name: "Explorer",
      component: () => import("../views/ExplorerPage.vue"),
    },
        {
      path: "/component",
      name: "Component",
      component: () => import("../views/ComponentPage.vue"),
    },
    {
      path: "/chart",
      name: "Charts",
      component: () => import("../views/CustomPage.vue"),
    },
    {
      path: "/storage",
      name: "Storage",
      component: () => import("../views/StoragePage.vue"),
    },
  ],
});

export default router;