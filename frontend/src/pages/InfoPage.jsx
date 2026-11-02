import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import Footer from "@/components/Footer";

const pages = {
  about: {
    title: "About XauCloud", description: "What XauCloud builds and who it is for.",
    sections: [
      ["Trading technology with explicit risk controls", "XauCloud develops gold (XAUUSD) trading automation for MetaTrader 5, with an accompanying Command Center for licensed customers. It is trading software, not a broker, bank, custodian or promise of financial returns."],
      ["Evaluate the real evidence", "Review the published performance records and the separately labeled 30-day historical test before deciding. Test software on a demo account first and verify compatibility with your own broker."],
      ["How you can access it", "XauCloud offers an eligible three-trading-market-day signal experience and a separate one-time EA license purchase. Approved manual payments are reviewed before a license is issued."],
    ],
  },
  contact: {
    title: "Contact XauCloud", description: "Verified customer support channels for XauCloud.",
    sections: [["Customer support", "For questions about installation, accounts, licenses, invoices or payments, use the contact details below when published or open the support area of your signed-in Command Center. Never send wallet seed phrases, account passwords or your license PIN."],
      ["Payments", "Use the exact order reference when requesting help. A screenshot of a payment is not proof that funds reached the verified beneficiary or wallet."]]
  },
  terms: {
    title: "XauCloud Terms of Use", description: "Information to review before purchasing or using XauCloud.",
    sections: [
      ["Product and eligibility", "XauCloud is automated trading software for MetaTrader 5. Customer use requires a compatible broker, an appropriately configured platform, and the agreed license terms. The signal trial does not grant an MT5 EA license."],
      ["Payments and activation", "A one-time purchase is separate from the three-market-day signal trial. The applicable USD price and license entitlement are disclosed in checkout. Manual bank or cryptocurrency submissions remain pending until independent verification and authorized approval; submission alone does not activate a license."],
      ["Account responsibilities", "Protect account credentials and license information. Use the trading software only where lawful and according to your broker's rules. Do not attempt to evade licensing or abuse the free trial."],
      ["Service and disputes", "Contact XauCloud support with your order reference for questions about delivery or payment disputes. Any refunds or statutory consumer rights are governed by the applicable transaction terms and law; no blanket refund or lifetime-update promise is made here."],
      ["Trading risks", "No trade outcome, profitability or uptime is guaranteed. Automated trading can lead to loss of all exposed trading capital. See the risk disclosure before use."],
    ],
  },
  privacy: {
    title: "XauCloud Privacy Notice", description: "Summary of information involved in using XauCloud.",
    sections: [
      ["Information processed", "Creating an account and purchasing software can require contact details, authentication records, order information, support messages and relevant licensing records. Manual payment review may include references or optional submitted evidence."],
      ["How it is used", "Information is used to operate accounts, process payment reviews, issue and manage licenses, provide support, protect systems from fraud and keep transaction records."],
      ["Security and access", "Administrative payment evidence is restricted to authorized reviewers. Do not send passwords or other secrets through support. Payment history may be retained for financial and audit obligations even after account closure."],
      ["Your requests", "Request account information, corrections or applicable data-rights assistance through the support contact information published on this site or the Command Center. Regulatory retention obligations may apply."],
    ],
  },
  risk: {
    title: "XauCloud Trading Risk Disclosure", description: "Understand substantial risks of automated gold trading.",
    sections: [
      ["Capital can be lost", "Trading Gold (XAUUSD), particularly with leverage, can lead to substantial and rapid losses, including the entire amount exposed to trading. No result is guaranteed."],
      ["Historical and simulated results", "Backtests and Strategy Tester reports are simulated historical exercises, not live trading accounts or independently verified future returns. Actual fills, spreads, slippage and broker conditions differ."],
      ["Technology limitations", "Software, VPS networks, terminals, broker connections, market liquidity and execution systems can fail. A stop-loss cannot guarantee execution at its requested price."],
      ["Your decisions", "Review risk settings, your account limits and local restrictions. Verify the system on demo, monitor performance and use only risk capital you can afford to lose."],
    ],
  },
};

export default function InfoPage({ kind }) {
  const page = pages[kind];
  const [contact, setContact] = useState(null);
  useEffect(() => {
    if (kind !== "contact") return;
    let mounted = true;
    fetch("/api/public/contact").then((r) => r.ok ? r.json() : null)
      .then((v) => { if (mounted) setContact(v); }).catch(() => {});
    return () => { mounted = false; };
  }, [kind]);
  if (!page) return null;
  return <div className="min-h-screen bg-[#f7f6f2] text-[#1a3030]" data-testid="info-page">
    <Seo title={page.title + " — XauCloud"} description={page.description} path={"/" + kind} />
    <header className="border-b border-[#e8e1d5] bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-5">
        <Link to="/" className="text-[15px] font-bold tracking-tight text-[#182c2b]">XauCloud</Link>
        <Link to="/" className="rounded-full border border-[#d6c6a7] px-4 py-2 text-xs font-bold text-[#715d36] hover:bg-[#f6f0e5]">Homepage</Link>
      </div>
    </header>
    <main className="mx-auto max-w-4xl px-5 py-12 md:py-20">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#74531f]">Official information</p>
      <h1 className="mt-3 max-w-3xl font-heading text-[2.25rem] font-semibold leading-tight tracking-tight sm:text-[3.1rem]">{page.title}</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-8 text-[#475c56]">{page.description}</p>
      <div className="mt-10 space-y-4">
        {page.sections.map(([heading, body]) => <section key={heading} className="rounded-[19px] border border-[#e4ded2] bg-white p-6 sm:p-8">
          <h2 className="font-heading text-lg font-semibold">{heading}</h2><p className="mt-3 text-sm leading-7 text-[#455a54]">{body}</p>
        </section>)}
        {kind === "contact" && <section className="rounded-[19px] border border-[#d4c09c] bg-[#f0ebdf] p-6 sm:p-8">
          <h2 className="font-heading text-lg font-semibold">Published support contact</h2>
          {contact?.email && <p className="mt-4 text-sm"><strong>Email:</strong> <a className="break-all underline underline-offset-4" href={"mailto:" + contact.email}>{contact.email}</a></p>}
          {contact?.telephone && <p className="mt-3 text-sm"><strong>Telephone:</strong> <a className="underline underline-offset-4" href={"tel:" + contact.telephone.replace(/[^+0-9]/g, "")}>{contact.telephone}</a></p>}
          {contact?.address && <p className="mt-3 text-sm leading-7"><strong>Business address:</strong> {[contact.address.streetAddress, contact.address.addressLocality, contact.address.addressRegion, contact.address.addressCountry].filter(Boolean).join(", ")}</p>}
          {!contact?.email && !contact?.telephone && <p className="mt-3 text-sm text-[#526260]">Support contact details have not been published by the administrator. Sign in to your Command Center for authenticated support.</p>}
          <Link to="/command" className="mt-5 inline-flex rounded-full bg-[#183332] px-5 py-3 text-xs font-bold text-white">Open Command Center</Link>
        </section>}
      </div>
      <nav aria-label="Information pages" className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-[#876b40]">
        {Object.keys(pages).map((id) => <Link key={id} to={"/" + id} className="hover:underline">{pages[id].title}</Link>)}
      </nav>
    </main>
    <Footer />
  </div>;
}
