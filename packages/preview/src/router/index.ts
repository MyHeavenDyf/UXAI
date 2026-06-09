import { createRouter, createWebHistory } from "vue-router";
import PreviewPage from "../views/PreviewPage.vue";

const router = createRouter({
  history: createWebHistory(),
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
      path: "/icon",
      name: "Icon",
      component: () => import("../views/IconPage.vue"),
    },
  ],
});

export default router;