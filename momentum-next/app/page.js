'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    // Check if already logged in and premium
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (user && user.isLoggedIn && user.isPremium) {
        router.replace('/dashboard');
        return;
      }
    } catch { /* ignore */ }

    // Check Supabase session
    const supabase = getSupabase();
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          const existingUser = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return {}; } })() || {};
          const updatedUser = {
            name: session.user.user_metadata.full_name,
            email: session.user.email,
            picture: session.user.user_metadata.avatar_url,
            isLoggedIn: true,
            isPremium: existingUser.isPremium || false,
          };
          localStorage.setItem('user', JSON.stringify(updatedUser));
          if (updatedUser.isPremium) router.replace('/dashboard');
        }
      }).catch(() => { });
    }

    // FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
      const question = item.querySelector('.faq-question');
      if (!question) return;
      const handler = () => {
        const isActive = item.classList.contains('active');
        faqItems.forEach(i => i.classList.remove('active'));
        if (!isActive) item.classList.add('active');
      };
      question.addEventListener('click', handler);
    });
  }, [router]);

  async function handleLogin() {
    const supabase = getSupabase();
    if (!supabase) { alert('Supabase not configured.'); return; }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/dashboard' },
    });
    if (error) alert('Login failed: ' + error.message);
  }

  function handleBuyNow() {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } })();
    if (!user || !user.isLoggedIn) {
      alert('Please login with Google first to purchase the Momentum Pass.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const options = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY || 'rzp_live_SLR8h7buAJQFlF',
      amount: '19900',
      currency: 'INR',
      name: 'Momentum Tutorials',
      description: 'Full Momentum Pass - Lifetime Access',
      handler: function (response) {
        user.isPremium = true;
        localStorage.setItem('user', JSON.stringify(user));
        alert('Payment Successful! Welcome to Momentum Premium.');
        window.location.href = '/dashboard';
      },
      prefill: { name: user.name || '', email: user.email || '' },
      theme: { color: '#4ade80' },
    };
    if (typeof window !== 'undefined' && window.Razorpay) {
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      alert('Payment gateway not loaded. Please refresh and try again.');
    }
  }

  return (
    <>
      {/* Razorpay script */}
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      {/* Header */}
      <header className="landing-header">
        <div className="container container-nav">
          <a href="/" className="logo">
            <span className="logo-icon">✦</span>
            <span>Momentum</span>
          </a>
          <nav className="nav">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="nav-login-btn" onClick={handleLogin}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Login
          </button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="hero">
          <div className="container">
            <p className="hero-badge">✦ MOMENTUM</p>
            <h1 className="hero-title">Dream Bigger.<br />Become Greater.</h1>
            <p className="hero-subtitle">
              You don&apos;t discover your potential by thinking about it.<br />
              You discover it by building habits and executing goals every single day.
            </p>
            <p className="hero-tagline">Give momentum to your dreams.</p>
            <div className="hero-actions">
              <button className="btn btn-gradient" onClick={handleLogin}>Start Your Journey</button>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="features" id="features">
          <div className="container">
            <h2 className="section-title">Everything you need to<br />stay consistent</h2>
            <div className="features-list">
              {['Daily Habit Tracking', 'Automated Progress Charts', 'Weekly & Monthly View', 'Add Upto 99 Habits', 'Automatic Streaks', 'Works with Google Sheets & Excel', 'Editable Offline'].map(f => (
                <div className="feature-item" key={f}>
                  <span className="check-icon">✓</span>
                  <p>{f}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pain Points */}
        <section className="systems">
          <div className="container">
            <h2 className="section-title">Why staying consistent feels impossible?</h2>
            <p className="section-subtitle">
              You don&apos;t fail at habits because you&apos;re lazy.<br />
              You fail because progress is hard to see.
            </p>
            <div className="pain-points">
              {["You start strong, then miss one day", "Tracking stops, motivation fades", "Progress disappears, habits feel pointless"].map(p => (
                <div className="pain-item" key={p}>
                  <span className="cross-icon">✕</span>
                  <p>{p}</p>
                </div>
              ))}
            </div>
            <div className="quote-container">
              <blockquote>
                &ldquo;You do not rise to the level of your goals.<br />
                You fall to the level of your systems.&rdquo;
              </blockquote>
              <cite>— James Clear, Atomic Habits</cite>
            </div>
            <p className="systems-highlight">THAT&apos;S WHY SYSTEMS MATTER MORE THAN MOTIVATION.</p>
          </div>
        </section>

        {/* Pricing */}
        <section className="premium-pricing" id="pricing">
          <div className="container">
            <div className="premium-card">
              <div className="premium-badge">COMPLETE ACCESS</div>
              <div className="premium-header">
                <h2 className="premium-title">Full Momentum Pass</h2>
                <div className="price-container">
                  <span className="currency">₹</span>
                  <span className="price">199</span>
                  <span className="period">/ One-Time</span>
                </div>
                <p className="premium-description">
                  Everything you need to build discipline, execute consistently, and achieve your biggest goals.
                </p>
              </div>
              <div className="premium-features">
                {[
                  { icon: '✅', title: 'Build', items: ['Set clear goals and track your progress', 'Analyze your habits with powerful insights', 'Design your personal Dream Plan'] },
                  { icon: '✅', title: 'Execute', items: ['Get visual momentum tracking', 'Structured daily action system', 'Stay accountable with streak tracking'] },
                  { icon: '✅', title: 'Achieve', items: ['Compete against your past self', 'Build unstoppable consistency', 'Measure growth with real performance analytics'] },
                ].map(g => (
                  <div className="feature-group" key={g.title}>
                    <h3><span className="group-icon">{g.icon}</span>{g.title}</h3>
                    <ul>{g.items.map(i => <li key={i}>{i}</li>)}</ul>
                  </div>
                ))}
              </div>
              <div className="premium-cta">
                <p className="lifetime-text">Lifetime Access – Pay Once, Learn Forever</p>
                <button className="btn-premium-cta" onClick={handleBuyNow}>
                  Get Lifetime Access Now – ₹199
                </button>
                <p className="secure-text">Secure payment. Instant access. No recurring charges.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="faq" id="faq">
          <div className="container container-small">
            <h2 className="section-title">Frequently Asked Questions</h2>
            <div className="faq-list">
              {[
                { q: 'Is this a subscription or a one-time payment?', a: 'Momentum is a one-time payment. No monthly fees, no hidden costs. Pay once, use it for life.' },
                { q: 'How does the Google Sheets sync work?', a: 'You can connect your Google account to automatically sync your habit data. It works both ways.' },
                { q: 'Can I use it offline?', a: 'Yes! Momentum is built to work seamlessly offline. Your progress will sync automatically when reconnected.' },
                { q: 'What if I\'m not satisfied?', a: 'We offer a 30-day money-back guarantee. If Momentum doesn\'t help you build better systems, we\'ll refund with no questions asked.' },
              ].map(({ q, a }) => (
                <div className="faq-item" key={q}>
                  <div className="faq-question">
                    <h3>{q}</h3>
                    <span className="faq-toggle">+</span>
                  </div>
                  <div className="faq-answer"><p>{a}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-top">
            <div className="logo" style={{ color: 'white' }}>
              <span className="logo-icon">✦</span>
              <span>Momentum</span>
            </div>
            <div className="footer-links">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
              <a href="#">Contact Us</a>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© 2026 Momentum Habit Tracker. Designed for consistency.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
