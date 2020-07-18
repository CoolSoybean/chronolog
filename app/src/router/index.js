import Vue from 'vue'
import VueRouter from 'vue-router'
import UnderConstruction from '../views/UnderConstruction'

Vue.use(VueRouter)

  const routes = [
  {
    path: '/timesheet',
    name: 'Timesheet',
    component: UnderConstruction
  },
  {
    path: '/calendar',
    name: 'Calendar',
    component: UnderConstruction
  },
  {
    path: '/todo',
    name: 'Todo',
    component: UnderConstruction
  },
  {
    path: '/contacts',
    name: 'Contacts',
    component: () => import('../views/ContactList.vue')
  },
  {
    path: '/contacts/:id(new|\\d+)',
    name: 'ContactDetails',
    component: () => import('../views/ContactDetails.vue')
  },
  {
    path: '/organisations',
    name: 'Organisations',
    component: () => import('../views/OrganisationList.vue')
  },
  {
    path: '/organisations/:id(new|\\d+)',
    name: 'OrganisationDetails',
    component: UnderConstruction
  },
]

const router = new VueRouter({
  mode: 'history',
  base: process.env.BASE_URL,
  routes
})

export default router
