/* Seeds the initial admin (from env), website content and sample plans. Safe to run repeatedly. */
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env';
import { hashPassword } from '../src/lib/security';
import { normalizeEmail, normalizePhone } from '../src/lib/identity';

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const img = (id: string, w = 1200) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD, ADMIN_FULL_NAME } = env;
  if (!ADMIN_EMAIL || !ADMIN_PHONE || !ADMIN_PASSWORD) {
    console.log('ADMIN_EMAIL / ADMIN_PHONE / ADMIN_PASSWORD not set — skipping admin bootstrap.');
    return;
  }
  if (ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
  const email = normalizeEmail(ADMIN_EMAIL);
  const phone = normalizePhone(ADMIN_PHONE);
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }, { role: 'ADMIN' }] } });
  if (existing) {
    console.log(`Admin already present (${existing.email ?? existing.phone}) — password left unchanged.`);
    return;
  }
  await prisma.user.create({
    data: {
      fullName: ADMIN_FULL_NAME,
      email,
      phone,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: 'ADMIN',
      status: 'ACTIVE',
      verifiedAt: new Date(),
    },
  });
  console.log(`Created admin account: ${email}`);
}

async function seedContent() {
  // Settings are only created when missing, so re-seeding never overwrites admin edits.
  const defaults: Record<string, object> = {
    general: {
      gymName: 'Usman Gym',
      tagline: 'Build Strength. Build Discipline.',
      description:
        'A no-nonsense training space with serious equipment, experienced coaches and a community that pushes you further.',
    },
    contact: {
      address: '123 Fitness Street, Main Boulevard, Your City',
      phone: '+92 300 0000000',
      email: 'info@usmangym.example',
      mapUrl: '',
      hours: [
        { label: 'Mon – Sat', time: '5:00 AM – 11:00 PM' },
        { label: 'Sunday', time: '7:00 AM – 2:00 PM' },
      ],
    },
    social: { facebook: '#', instagram: '#', youtube: '#', twitter: '' },
    payment: {
      instructions:
        'Pay your monthly fee by bank transfer or mobile wallet to the account shared by the gym, then upload a clear screenshot here. (Admin: set your real account details in Website Content.)',
    },
    membership: {
      note: 'Choosing a plan or sending an enquiry does not confirm your membership. Membership starts once the gym admin registers you and your monthly fee is collected at the gym.',
    },
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.websiteSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  if ((await prisma.membershipPlan.count()) === 0) {
    await prisma.membershipPlan.createMany({
      data: [
        { name: 'Standard', description: 'Full access to the gym floor during opening hours.', monthlyFee: '3000', features: ['Strength & cardio zones', 'Free weights area', 'Locker room access', 'Basic fitness orientation'], sortOrder: 1 },
        { name: 'Premium', description: 'Everything in Standard plus coaching support.', monthlyFee: '4500', features: ['Everything in Standard', 'Monthly progress review', 'Customised workout plan', 'Group functional classes'], sortOrder: 2, isFeatured: true },
        { name: 'Personal Training', description: 'One-to-one coaching with a certified trainer.', monthlyFee: '8000', features: ['Everything in Premium', 'Dedicated personal trainer', 'Diet guidance', 'Flexible session timing'], sortOrder: 3 },
      ],
    });
  }

  if ((await prisma.faq.count()) === 0) {
    const faqs: [string, string][] = [
      ['What are the gym opening hours?', 'We are open Monday to Saturday 5:00 AM – 11:00 PM and Sunday 7:00 AM – 2:00 PM. Hours may change on public holidays.'],
      ['What are the membership fees?', 'Plans start from Rs. 3,000 per month. See the Membership page for all plans. The exact fee for you is set by the gym admin when you are registered.'],
      ['How do monthly payments work?', 'Your fee is due at the start of every month. You pay the gym admin directly (cash or bank transfer) and the admin records the payment, which then appears in your member portal.'],
      ['How can I become a member?', 'Visit the gym or send us an enquiry through the contact form. The gym admin will register you, and you will receive a message to activate your online account.'],
      ['How can I check my payment status?', 'Log in to the member portal with your account. Your current month status, outstanding fees and full payment history are shown there.'],
      ['What happens if my monthly fee is pending?', 'A pending fee stays on your account until it is paid. Unpaid months are never cleared automatically, and a month that stays unpaid is shown as overdue. Please settle it with the gym admin.'],
      ['How can I contact the gym?', 'Call or email us using the details on the Contact page, send a message through the form, or visit us during opening hours.'],
    ];
    await prisma.faq.createMany({ data: faqs.map(([question, answer], i) => ({ question, answer, sortOrder: i + 1 })) });
  }

  if ((await prisma.galleryImage.count()) === 0) {
    const gallery: [string, string, string][] = [
      ['1534438327276-14e5300c3a48', 'Dumbbell rack', 'Equipment'],
      ['1540497077202-7c8a3999166f', 'Cardio & machines floor', 'Facilities'],
      ['1571902943202-507ec2618e8f', 'Open training floor', 'Facilities'],
      ['1532029837206-abbe2b7620e3', 'Bench press station', 'Training'],
      ['1546483875-ad9014c88eba', 'Dumbbell rows', 'Training'],
      ['1576678927484-cc907957088c', 'Free weights', 'Equipment'],
      ['1599058917212-d750089bc07e', 'Battle rope conditioning', 'Training'],
      ['1517836357463-d25dfeac3438', 'Barbell deadlift', 'Training'],
      ['1593079831268-3381b0db4a77', 'Treadmill zone', 'Facilities'],
    ];
    await prisma.galleryImage.createMany({
      data: gallery.map(([id, caption, category], i) => ({ url: img(id), caption, category, sortOrder: i + 1 })),
    });
  }

  await prisma.counter.upsert({ where: { key: 'gym_id' }, create: { key: 'gym_id', value: 1000 }, update: {} });
}

async function main() {
  await seedAdmin();
  await seedContent();
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
