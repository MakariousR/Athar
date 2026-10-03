// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A realistic multi-section document (like an uploaded PDF report) used to test
 * that follow-up questions find the right part of an attached file.
 */
const sections = [
  ['Executive summary', 'Northwind Bakery Supplies closed fiscal year 2025 with revenue of 4.2 million euros, up 18 percent. Growth came mainly from the new online ordering portal and two large hotel contracts in Lyon. Net profit was 310,000 euros after the one-time cost of moving the warehouse.'],
  ['Budget for 2026', 'The board approved an operating budget of 3.6 million euros for 2026. Marketing receives 420,000 euros, most of it for search ads and trade fairs. The IT budget is 280,000 euros, including the replacement of the old ERP system. A reserve of 150,000 euros is kept for unexpected equipment repairs.'],
  ['Main risks', 'The biggest risk is the price of flour, which rose 27 percent in 2025 and depends on the wheat harvest. A second risk is dependence on one delivery partner, FastFreight, which handles 70 percent of shipments. Energy costs for the ovens and cold storage are the third risk. Mitigation: a second delivery partner will be signed by March and flour will be bought on six-month contracts.'],
  ['Hiring plan', 'We plan to hire eleven people in 2026: four drivers, three warehouse staff, two customer support agents, one data analyst and one head of e-commerce. Hiring the head of e-commerce is the priority for the first quarter. Salaries for new roles are budgeted at 390,000 euros in total.'],
  ['Product roadmap', 'The mobile app for repeat orders launches in May 2026. Subscription boxes for cafés follow in September. We will stop selling the frozen dough line in June because margins fell below four percent. A gluten-free range is being tested with three pilot customers.'],
  ['Customers and churn', 'The company serves 1,340 active business customers. Monthly churn fell from 3.1 percent to 2.2 percent after the introduction of account managers for customers spending over 5,000 euros a year. The ten largest customers represent 34 percent of revenue, which is a concentration we want to reduce.'],
  ['Sustainability', 'Packaging moved to recycled cardboard in 2025, cutting plastic use by 60 percent. Two electric vans were added to the fleet, and solar panels on the new warehouse roof now cover about a quarter of its electricity use. The goal is a fully electric city delivery fleet by 2028.'],
  ['Information security', 'An external audit in November found weak password rules and no two-factor login on the ordering portal. Two-factor authentication will be mandatory for all staff by February 2026, and the portal will get it by April. Backups are now tested every month.'],
  ['Office and warehouse', 'The warehouse moved from Villeurbanne to a larger site in Saint-Priest with 6,500 square metres of storage. The move cost 180,000 euros and caused two weeks of slower deliveries in August. The head office stays in central Lyon until the lease ends in 2027.'],
  ['Appendix: key contacts', 'Chief executive: Claire Martin. Finance director: Hugo Bernard. Operations: Sofia Rossi. For supplier questions contact purchasing@northwind.example. The next board meeting is scheduled for 12 March 2026.']
];

// Long enough to span several pages like a real PDF (each section padded with related detail)
const text = sections.map(([title, body], i) =>
  `# ${i + 1}. ${title}\n\n${body}\n\n${body.split('. ').slice(0, 2).join('. ')}. Further details are available in the internal wiki for this section.\n`
).join('\n');

module.exports = { name: 'northwind-annual-report-2025.md', text };
