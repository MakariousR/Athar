/**
 * Small realistic history used by memory tests and threshold calibration:
 * several sources, dates, English + Arabic, long and short conversations.
 */
const t = (iso) => Math.floor(Date.parse(iso) / 1000);

const long = (topic, n) => Array.from({ length: n }, (_, i) => [
  { role: 'user', text: `Question ${i + 1} about ${topic}: can you explain step ${i + 1} in more detail?` },
  { role: 'assistant', text: `Step ${i + 1} of ${topic}: ${'This part covers the details and trade-offs involved. '.repeat(6)}` }
]).flat();

module.exports = [
  {
    id: 'gpt-postgres', source: 'chatgpt', title: 'Designing the database for the bakery app', createTime: t('2025-04-12T10:00:00Z'),
    messages: [
      { role: 'user', text: 'I am building an order system for my bakery. Should I use Postgres or MongoDB?' },
      { role: 'assistant', text: 'For orders, customers and inventory with clear relations, Postgres is the better fit. Use tables orders, order_items, customers and products with foreign keys.' },
      { role: 'user', text: 'We decided on Postgres. How should I index the orders table?' },
      { role: 'assistant', text: 'Add a B-tree index on orders(customer_id, created_at) and a partial index for status = \'pending\'.' }
    ]
  },
  {
    id: 'claude-react', source: 'claude', title: 'React state management', createTime: t('2025-11-03T09:00:00Z'),
    messages: [
      { role: 'user', text: 'My React app re-renders too much when the cart updates. Context or Zustand?' },
      { role: 'assistant', text: 'Zustand with selectors avoids re-rendering every consumer. Keep the cart in a Zustand store and select only the fields each component needs.' }
    ]
  },
  {
    id: 'gpt-trip', source: 'chatgpt', title: 'Trip to Japan itinerary', createTime: t('2024-07-20T12:00:00Z'),
    messages: [
      { role: 'user', text: 'Plan a 10 day trip to Japan in October: Tokyo, Kyoto, Osaka.' },
      { role: 'assistant', text: 'Days 1-4 Tokyo (Shibuya, Asakusa), days 5-8 Kyoto (Fushimi Inari, Arashiyama), days 9-10 Osaka (Dotonbori). Get a 7-day JR Pass.' }
    ]
  },
  {
    id: 'claude-arabic', source: 'claude', title: 'تعلم البرمجة بلغة بايثون', createTime: t('2026-02-10T18:00:00Z'),
    messages: [
      { role: 'user', text: 'أريد أن أتعلم البرمجة بلغة بايثون من الصفر، من أين أبدأ؟' },
      { role: 'assistant', text: 'ابدأ بأساسيات المتغيرات والحلقات والدوال، ثم تعلم التعامل مع الملفات والمكتبات مثل pandas. خصص ساعة يومياً للتمرين.' }
    ]
  },
  {
    id: 'gpt-sleep', source: 'chatgpt', title: 'Improving sleep', createTime: t('2025-01-15T22:00:00Z'),
    messages: [
      { role: 'user', text: 'I wake up at 3am every night and cannot fall back asleep.' },
      { role: 'assistant', text: 'Keep a fixed wake time, avoid caffeine after 2pm, and get morning daylight. If you wake at 3am, get up and read under dim light until sleepy.' }
    ]
  },
  {
    id: 'gpt-docker', source: 'chatgpt', title: 'Docker compose error', createTime: t('2025-06-02T08:00:00Z'),
    messages: [
      { role: 'user', text: 'docker compose up fails with "port is already allocated" on 5432' },
      { role: 'assistant', text: 'Another process (probably a local Postgres) is using port 5432. Stop it, or map the container to 5433:5432 in docker-compose.yml.' }
    ]
  },
  {
    id: 'claude-salary', source: 'claude', title: 'Negotiating a job offer', createTime: t('2025-09-08T14:00:00Z'),
    messages: [
      { role: 'user', text: 'I got an offer for a backend developer role at 70k. Should I negotiate?' },
      { role: 'assistant', text: 'Yes. Research the market range, then ask for 80k citing your Postgres and React experience. Be ready to accept 75k plus extra vacation.' }
    ]
  },
  {
    id: 'gpt-recipe', source: 'chatgpt', title: 'Sourdough starter', createTime: t('2024-03-05T07:00:00Z'),
    messages: [
      { role: 'user', text: 'My sourdough starter smells like acetone. Is it dead?' },
      { role: 'assistant', text: 'No — it is hungry. Feed it twice a day at 1:1:1 flour, water and starter, and keep it around 24°C.' }
    ]
  },
  {
    id: 'claude-long', source: 'claude', title: 'Kubernetes deep dive', createTime: t('2025-12-01T10:00:00Z'),
    messages: [
      ...long('Kubernetes networking', 12),
      { role: 'user', text: 'Final question: what did we decide for the ingress controller?' },
      { role: 'assistant', text: 'We decided to use Traefik as the ingress controller because it handles Let\'s Encrypt certificates automatically.' }
    ]
  },
  {
    id: 'gpt-arabic-food', source: 'chatgpt', title: 'وصفة الكبسة', createTime: t('2025-08-19T16:00:00Z'),
    messages: [
      { role: 'user', text: 'كيف أطبخ كبسة دجاج لستة أشخاص؟' },
      { role: 'assistant', text: 'تحتاج دجاجة كاملة وثلاثة أكواب أرز بسمتي وبهارات الكبسة والطماطم والبصل. اطبخ الدجاج أولاً ثم أضف الأرز إلى المرق.' }
    ]
  },
  {
    id: 'gemini-garden', source: 'gemini', title: 'Balcony tomatoes', createTime: t('2026-05-02T09:00:00Z'),
    messages: [
      { role: 'user', text: 'Which tomato varieties grow well in pots on a sunny balcony?' },
      { role: 'assistant', text: 'Cherry varieties like Sungold and Tiny Tim do well in 20-litre pots with daily watering in summer.' }
    ]
  },
  {
    id: 'gpt-taxes', source: 'chatgpt', title: 'Freelance taxes', createTime: t('2026-03-28T11:00:00Z'),
    messages: [
      { role: 'user', text: 'As a freelancer, how much of my income should I set aside for taxes?' },
      { role: 'assistant', text: 'A common rule is 25-30% of each payment into a separate account, adjusted for your country\'s rates.' }
    ]
  }
];
