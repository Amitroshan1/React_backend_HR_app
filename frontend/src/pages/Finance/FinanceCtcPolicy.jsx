import { BookOpen } from "lucide-react";
import "./FinanceCtcPolicy.css";

const TOC = [
  { id: "golden", label: "What actually pays" },
  { id: "roles", label: "Who does what" },
  { id: "ctc-flow", label: "CTC approval flow" },
  { id: "ctc-calc", label: "How CTC is calculated" },
  { id: "pack", label: "Govt PF / ESI pack" },
  { id: "decl-flow", label: "Tax declaration flow" },
  { id: "tds-flow", label: "TDS projection vs payroll" },
  { id: "tds-calc", label: "How TDS is calculated" },
  { id: "example", label: "Worked example" },
  { id: "dont", label: "Common mistakes" },
];

export function FinanceCtcPolicy() {
  return (
    <div className="fpol">
      <header className="fpol-hero">
        <span className="fpol-hero-icon">
          <BookOpen size={22} />
        </span>
        <div>
          <p className="fpol-kicker">Playbook for Accounts and Finance</p>
          <h1>CTC, TDS and tax declaration</h1>
          <p>
            This page is how the product works today (FY 2026–27). Use it before you approve a CTC,
            a pack adopt, or a tax proof. If a screen number disagrees with payroll, this page is the rule.
          </p>
        </div>
      </header>

      <nav className="fpol-toc" aria-label="On this page">
        {TOC.map((item) => (
          <a key={item.id} href={`#${item.id}`}>
            {item.label}
          </a>
        ))}
      </nav>

      <section id="golden" className="fpol-card fpol-card--gold">
        <h2>1. The one rule that removes confusion</h2>
        <p className="fpol-lead">
          <strong>Payslips, annexure PDF, and monthly TDS use only the last Finance-approved CTC</strong>
          {" "}and a payroll-ready tax declaration. A draft, a pending request, or a What-if projection never
          changes take-home until you publish it.
        </p>
        <div className="fpol-grid-2">
          <div>
            <h3>Does change payroll</h3>
            <ul>
              <li>Finance (or dual-role self-approve) publishes a CTC request</li>
              <li>Finance publishes an adopted statutory pack (and queued recals, if any)</li>
              <li>Employee tax declaration is <strong>submitted</strong> or <strong>approved</strong></li>
            </ul>
          </div>
          <div>
            <h3>Does not change payroll</h3>
            <ul>
              <li>Accounts clicking Submit for Finance</li>
              <li>HR / Admin intermediate ticks</li>
              <li>Employee saving a draft declaration</li>
              <li>Accounts TDS screen in What-if mode</li>
              <li>A pending CTC chip on the employee tax page</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="roles" className="fpol-card">
        <h2>2. Who does what</h2>
        <div className="fpol-table-wrap">
        <table className="fpol-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Does</th>
              <th>Does not</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Accounts</td>
              <td>Build CTC, submit for approval, set company policy, adopt a govt pack, project TDS</td>
              <td>Publish live CTC (unless they are also Finance and self-approve is on)</td>
            </tr>
            <tr>
              <td>HR</td>
              <td>Optional first tick if “HR prepare first” is on</td>
              <td>Rewrite payroll on their own</td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>Optional extra tick if the hike % is at or above the company threshold</td>
              <td>Skip Finance unless they are also Finance</td>
            </tr>
            <tr>
              <td>Finance</td>
              <td>Last publish / reject of CTC and pack adopt; tax proof queue; payroll review</td>
              <td>Edit the CTC structure (Accounts still owns the numbers)</td>
            </tr>
            <tr>
              <td>Employee</td>
              <td>File tax declaration; see tax projection on last approved CTC</td>
              <td>See draft CTC in their tax number</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <section id="ctc-flow" className="fpol-card">
        <h2>3. CTC approval flow</h2>
        <ol className="fpol-steps">
          <li>
            <strong>Accounts prepares</strong> the structure on CTC breakup (basic, HRA, allowances, PF/ESI flags).
            The studio can show a new structure. That is still a draft.
          </li>
          <li>
            <strong>Submit for Finance</strong> writes a change request. Live <code>ctc_breakups</code> stays as last approved.
          </li>
          <li>
            If policy says <strong>HR prepare first</strong> and Accounts is not HR, status is <code>pending_hr</code>.
          </li>
          <li>
            If hike % is at/above <strong>Admin increment threshold</strong> (example 25), status becomes <code>pending_admin</code>.
            0 turns this off.
          </li>
          <li>
            <strong>Finance approves</strong> → live CTC is rewritten. Payslip, PDF, TDS now use the new structure.
            Reject or withdraw → live CTC unchanged.
          </li>
        </ol>
        <p>
          <strong>Self-approve:</strong> if the same person is Accounts (or HR/Admin) and Finance, and
          “Self-approve if dual role” is on, submit publishes in one step. Turn the flag off if you want a second pair of eyes.
        </p>
        <p>
          Finance home <strong>CTC approvals</strong> lists drafts. Only <code>pending_finance</code> can be published there.
          Earlier steps wait on HR or Admin.
        </p>
      </section>

      <section id="ctc-calc" className="fpol-card">
        <h2>4. How CTC is calculated</h2>
        <p>The app structures Indian CTC; it does not invent a new PF law. Core monthly pieces:</p>
        <div className="fpol-table-wrap">
        <table className="fpol-table">
          <thead>
            <tr>
              <th>Piece</th>
              <th>How we compute it</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>PF wage</td>
              <td>Basic + DA. Capped at the active govt pack (₹15,000 until 16 Sep 2026; ₹25,000 from 17 Sep 2026). Unrestricted PF is a company toggle.</td>
            </tr>
            <tr>
              <td>Employee EPF</td>
              <td>12% of capped PF wage (or a % of basic if EPF mode is percent).</td>
            </tr>
            <tr>
              <td>Employer PF / EPS</td>
              <td>12% of capped wage. EPS is 8.33% of wage, max ₹2,082.50 from the 25k pack. Rest stays in EPF.</td>
            </tr>
            <tr>
              <td>ESI</td>
              <td>If monthly gross is under ₹21,001 (or once-covered is on). Employee 0.75%, employer 3.25%.</td>
            </tr>
            <tr>
              <td>Statutory bonus</td>
              <td>Only if the company includes it and wage is eligible (≤ ₹21,000 unless you turn eligibility off).</td>
            </tr>
            <tr>
              <td>HRA</td>
              <td>% of basic (policy default 40%, clamp 5–50%). Metro vs non-metro is for tax exemption, not for this head.</td>
            </tr>
            <tr>
              <td>Annual CTC</td>
              <td>Gross × 12 plus employer costs you chose to include (PF admin, EDLI, bonus, LWF, NPS, mediclaim).</td>
            </tr>
          </tbody>
        </table>
        </div>
        <div className="fpol-example">
          <h3>Mini example — PF after 17 Sep 2026</h3>
          <p>Basic ₹22,000, DA ₹0. PF wage = ₹22,000, under the ₹25,000 ceiling, so PF is 12% × 22,000 = <strong>₹2,640</strong> each side.</p>
          <p>If the same person sat on the old ₹15,000 pack, PF would have been 12% × 15,000 = <strong>₹1,800</strong>. That is why Finance must approve “adopt pack + queue recalc” before staff with wage above ₹15,000 are rewritten.</p>
        </div>
      </section>

      <section id="pack" className="fpol-card">
        <h2>5. Adopting a government pack</h2>
        <ol className="fpol-steps">
          <li>Accounts opens CTC policy and reviews the active pack (PF ceiling shown on the CTC studio chip).</li>
          <li><strong>Adopt current govt pack</strong> only switches the company pack after Finance approve. Existing staff rows stay as-is.</li>
          <li>
            <strong>Adopt pack + queue staff recalc</strong> also lists employees whose PF wage is above ₹15,000.
            After Finance approve, those live CTCs are recomputed on the new pack. Others are not auto-touched.
          </li>
        </ol>
        <p>There is no live EPFO website pull. Packs are dated files in the product (including S.O. 5109(E) 17 Sep 2026).</p>
      </section>

      <section id="decl-flow" className="fpol-card">
        <h2>6. Tax declaration flow</h2>
        <ol className="fpol-steps">
          <li>Employee files for the FY (default <strong>New Tax Regime</strong> from FY 2026–27).</li>
          <li><strong>Draft</strong> — saved only. Does not move payroll TDS. Employee tax page also ignores it (same as payroll).</li>
          <li><strong>Submitted</strong> — provisional. Payroll TDS uses it unless Accounts set “approved declarations only”.</li>
          <li>Finance / Accounts review proofs. <strong>Approved</strong> is final for that phase.</li>
          <li>Year-end proofs can move the file to a final phase; then final amounts replace estimates.</li>
        </ol>
        <p>
          New regime: almost no Chapter VI-A (no 80C / 80D / HRA). Allowed: standard deduction ₹75,000,
          employer NPS 80CCD(2) up to 14% of basic+DA, and any other eligible new-regime line they declare.
          Old regime: 80C ₹1.5L (includes EPF), 80D, HRA exemption, 80CCD(1B) ₹50k, Sec 24, 80E, 80G at 50% or 100%, P.Tax.
        </p>
      </section>

      <section id="tds-flow" className="fpol-card">
        <h2>7. TDS projection vs payroll — two modes</h2>
        <div className="fpol-table-wrap">
        <table className="fpol-table">
          <thead>
            <tr>
              <th>Screen</th>
              <th>Mode</th>
              <th>CTC used</th>
              <th>Declaration used</th>
              <th>Hits payslip?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Accounts → TDS projection</td>
              <td>Payroll-ready (default)</td>
              <td>Last approved</td>
              <td>Submitted or approved</td>
              <td>Yes — this is the payroll number</td>
            </tr>
            <tr>
              <td>Accounts → TDS projection</td>
              <td>What-if</td>
              <td>Pending CTC draft if one exists</td>
              <td>Draft allowed + optional overrides</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Employee → Tax projection</td>
              <td>Always payroll-ready</td>
              <td>Last approved (pending CTC is a chip only)</td>
              <td>Submitted or approved</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Monthly payroll</td>
              <td>—</td>
              <td>Last approved</td>
              <td>Submitted or approved</td>
              <td>This is the deduction</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p>
          Every projection carries a <strong>TDS basis</strong> banner: mode, CTC basis, declaration status,
          and whether payroll would use these inputs. If the banner says What-if or pending CTC, do not treat the rupee figure as committed.
        </p>
      </section>

      <section id="tds-calc" className="fpol-card">
        <h2>8. How TDS is calculated (salary, s.392 / old s.192)</h2>
        <ol className="fpol-steps">
          <li>
            <strong>Project annual salary</strong> = YTD gross already paid this FY + current monthly gross × months left.
            If there is no YTD yet, monthly gross × months in FY (from DOJ).
          </li>
          <li>
            <strong>Add</strong> other income and previous-employer taxable (mid-year joiners). Then subtract exemptions.
          </li>
          <li>
            <strong>New regime slabs (FY 2026–27, unchanged in Budget 2026):</strong> nil to ₹4L; then 5 / 10 / 15 / 20 / 25 / 30%
            in ₹4L bands up to ₹24L+. Standard deduction ₹75,000. 87A rebate up to ₹60,000 if taxable ≤ ₹12L
            (with marginal relief just above ₹12L). Health &amp; education cess 4%. Surcharge from ₹50L (10 / 15 / 25%, no 37%).
          </li>
          <li>
            <strong>Old regime:</strong> slabs from ₹2.5L (₹3L if 60+, ₹5L if 80+). Standard deduction ₹50,000.
            87A if taxable ≤ ₹5L (rebate ₹12,500 + relief).
          </li>
          <li>
            <strong>Monthly TDS</strong> = (annual tax − previous employer TDS − TDS already deducted here) ÷ months remaining.
            Rounded to the rupee.
          </li>
        </ol>
        <p>
          Employer NPS on CTC is auto-filled as 80CCD(2). 80G uses 50% or 100% as declared.
          80D is capped (self ₹25k / ₹50k if senior; parents ₹25k / ₹50k if marked senior).
        </p>
      </section>

      <section id="example" className="fpol-card fpol-card--example">
        <h2>9. Worked example — read this once</h2>
        <p>Priya, joined before April. Approved CTC monthly gross ₹80,000. New regime. No declaration yet. Today 1 Oct 2026 (6 months left). YTD gross already paid Apr–Sep = ₹4,80,000.</p>
        <ol className="fpol-steps">
          <li>Projected annual gross = 4,80,000 + (80,000 × 6) = <strong>₹12,60,000</strong>.</li>
          <li>Minus standard deduction ₹75,000 → taxable <strong>₹11,85,000</strong>.</li>
          <li>₹11,85,000 is under ₹12L, so 87A wipes the slab tax. Annual tax = <strong>₹0</strong>. Monthly TDS = ₹0.</li>
        </ol>
        <p>Accounts now submits a hike to monthly gross ₹1,20,000. Finance has <strong>not</strong> approved.</p>
        <ul>
          <li>Payroll-ready TDS and Priya’s tax page still use ₹80,000. Same ₹0 story if YTD is unchanged.</li>
          <li>What-if on Accounts uses ₹1,20,000. Projected gross = 4,80,000 + 1,20,000 × 6 = ₹12,00,000, taxable ₹11,25,000 → still nil. That is only a preview.</li>
        </ul>
        <p>Finance approves the CTC. Next payroll and both projections switch to ₹1,20,000. If later YTD + remaining months push taxable over ₹12L, TDS starts. That is expected — not a bug.</p>
        <p>
          If Priya joined from another company with ₹3,00,000 taxable already and ₹15,000 TDS deducted, we add ₹3,00,000 to income
          and subtract ₹15,000 from remaining tax. Forgetting previous-employer income under-deducts.
        </p>
      </section>

      <section id="dont" className="fpol-card">
        <h2>10. Do not mix these up</h2>
        <ul className="fpol-dont">
          <li>
            <strong>CTC studio numbers vs TDS.</strong> After Submit, the studio can look new. TDS Payroll-ready is still old until you approve.
          </li>
          <li>
            <strong>Employee OTP on payslip vs Accounts.</strong> Accounts / HR / Admin skip payslip OTP, including on their own CTC. Employees do not.
          </li>
          <li>
            <strong>Adopt pack is not “recalc everyone”.</strong> Recalc only queues staff with PF wage above ₹15,000, and only after Finance approve.
          </li>
          <li>
            <strong>Draft tax file ≠ lower TDS.</strong> The employee can see a draft on the declaration form. Projection and payroll wait for submit/approve.
          </li>
          <li>
            <strong>New regime is default.</strong> Old-regime 80C/HRA on the form do not reduce tax if they stayed on new.
          </li>
        </ul>
      </section>
    </div>
  );
}
