/*
 * ACS Admin
 * Which cards the Home page offers the logged-in user
 * Copyright 2026 University of Sheffield
 *
 * Each card leads somewhere, and shows only to a user who can read
 * what it leads to, by the same rule the navigation uses
 * (sections.js).
 */

import { Status } from './acl.js'
import { can_see } from './sections.js'

/** The Home page's cards, in order.
 * - key: names the card.
 * - section: the section rule the card is gated on.
 * - to: a route in this app, or
 * - href: (serviceClientStore) => an address outside it.
 */
export const HomeCards = [
  {
    /* The visualiser subscribes to the whole Sparkplug namespace, as
     * Live Activity does, so it has Live Activity's rule. */
    key: 'graph', title: 'Graph', section: 'activity',
    text: 'Visualise real-time data flow across the infrastructure in a graph view.',
    href: s => `${s.scheme}://visualiser.${s.baseUrl}`,
  }, {
    key: 'activity', title: 'Activity', section: 'activity',
    text: 'Visualise real-time data changes across the infrastructure in a table view.',
    to: '/activity',
  },
]

/** The cards the user can use. Empty while the ACL loads, so cards
 * appear rather than flash up and vanish. */
export function home_cards (c) {
  if (c.status === Status.Loading) return []
  return HomeCards.filter(card => can_see(c, card.section))
}
