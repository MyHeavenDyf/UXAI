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
    //     {
    //   path: "/icon",
    //   name: "Icon",
    //   component: () => import("../views/IconPage.vue"),
    // },
    {
      path: "/custom",
      name: "Custom",
      component: () => import("../views/CustomPage.vue"),
    },
  ],
});

export default router;