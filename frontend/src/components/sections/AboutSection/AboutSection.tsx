import React, { useState } from 'react';
import { aboutData } from '../../../data/aboutData';
import Section from '../../layout/Section/Section';
import SectionHeader from '../../ui/SectionHeader/SectionHeader';
import styles from './AboutSection.module.css';

const AboutSection: React.FC = () => {
  const [isStoryExpanded, setIsStoryExpanded] = useState(false);

  const toggleStory = () => {
    setIsStoryExpanded(!isStoryExpanded);
  };

  return (
    <Section id="about" className={styles.section}>
      <SectionHeader id="about-title" title="About" />

      <div className={styles.aboutGrid}>
        {/* Currently Building */}
        <div className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <span className={styles.terminalPrompt}>$ cat ./currently_building.md</span>
          </div>
          <div className={styles.cardContent}>
            <h3 className={styles.focusTitle}>In Progress</h3>
            <ul className={styles.focusList}>
              {aboutData.currentlyBuilding.map((item, index) => (
                <li key={index} className={styles.focusItem}>
                  <span className={styles.bullet}>▹</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Next Steps */}
        <div className={styles.missionCard}>
          <div className={styles.cardHeader}>
            <span className={styles.terminalPrompt}>$ ls ./next_steps/</span>
          </div>
          <div className={styles.cardContent}>
            <h3 className={styles.missionTitle}>Next Steps</h3>
            <ul className={styles.focusList}>
              {aboutData.nextSteps.map((item, index) => (
                <li key={index} className={styles.focusItem}>
                  <span className={styles.bullet}>▹</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Long-term Vision */}
        <div className={styles.focusCard}>
          <div className={styles.cardHeader}>
            <span className={styles.terminalPrompt}>$ cat ./vision.txt</span>
          </div>
          <div className={styles.cardContent}>
            <h3 className={styles.focusTitle}>Long-term Vision</h3>
            <ul className={styles.focusList}>
              {aboutData.vision.map((item, index) => (
                <li key={index} className={styles.focusItem}>
                  <span className={styles.bullet}>▹</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Achievements Grid */}
      <div className={styles.achievementsSection}>
        <h3 className={styles.achievementsTitle}>
          <span className={styles.terminalPrompt}>$ cat ./achievements.json</span>
        </h3>
        <div className={styles.achievementsGrid}>
          {aboutData.achievements.map((achievement, index) => (
            <div key={index} className={styles.achievementCard}>
              <div className={styles.achievementMetric}>{achievement.metric}</div>
              <div className={styles.achievementLabel}>{achievement.label}</div>
              {achievement.description && (
                <div className={styles.achievementDescription}>{achievement.description}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Read Full Story Section */}
      <div className={styles.fullStorySection}>
        <button 
          onClick={toggleStory} 
          className={styles.storyButton}
          aria-expanded={isStoryExpanded}
        >
          {isStoryExpanded ? 
            '▼ Collapse story' : 
            '▶ Read full story'
          }
        </button>

        {isStoryExpanded && (
          <div 
            className={styles.expandedBio}
            onClick={toggleStory}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                toggleStory();
              }
            }}
            aria-label="Click anywhere to collapse story"
            style={{ cursor: 'pointer' }}
          >
            <div className={styles.bioContent}>
              {/* Introduction */}
              <div className={styles.paragraph}>
                <p className={styles.introText}>
                  Hey there! I'm Yurii 👋 — an <span className={styles.highlight}>AI/ML Engineer</span> who transforms chaos into intelligent 
                  systems and believes every problem is just an algorithm waiting to be discovered.
                </p>
              </div>

              {/* Origin Story */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🏀 The Origin Story: From Basketball Courts to Binary Trees</h3>
                <p>
                  My journey began in the vibrant corridors of Ukrainian schools, where I was that kid who'd solve differential equations 
                  during basketball practice breaks. Yes, I was crushing it on the court — playing at a professional level until 13 and 
                  even snagging a <span className={styles.highlight}>national championship</span> — but my mind was always racing through mathematical 
                  dimensions far beyond the three-point line.
                </p>
                <p>
                  Picture this: while my teammates were strategizing plays, I was mentally modeling trajectory physics, calculating optimal 
                  shot angles, and wondering if I could write an algorithm to predict defensive patterns. That's when I realized my superpower 
                  wasn't just the crossover dribble — it was <span className={styles.highlightSecondary}>crossing over between physical and digital worlds</span>.
                </p>
              </div>

              {/* Academic Awakening */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🧬 The Academic Awakening: When Physics Met Code</h3>
                <p>
                  At 15, I stumbled into the mesmerizing world of <span className={styles.highlightTertiary}>non-linear dynamics</span>. The <span className={styles.highlight}>Lorenz system</span> became 
                  my obsession — those beautiful butterfly attractors that showed how tiny changes could cascade into hurricanes. I spent nights 
                  coding simulations, watching digital chaos unfold on my screen, and before I knew it, I was standing on the <span className={styles.highlightQuaternary}>Intel 
                  Techno ISEF stage in 2011</span>, clutching a second-place trophy and thinking, "This is just the beginning."
                </p>
                <p>
                  <span className={styles.highlight}>Moscow Institute of Physics and Technology (MIPT)</span> became my next playground. But here's 
                  where things got interesting — while everyone was religiously coding in <span className={styles.highlightTertiary}>C++</span> and <span className={styles.highlightTertiary}>Delphi</span>, I had a rebellious streak. I'd secretly 
                  rewrite entire university projects in <span className={styles.highlightSecondary}>Python</span>, this exotic new language that professors 
                  raised eyebrows at. "Why Python?" they'd ask. "Because the future speaks in Python," I'd reply, probably sounding like a tech prophet.
                </p>
              </div>

              {/* SpaceX Moment */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🚀 The SpaceX Moment: Simulating the Impossible</h3>
                <p>
                  2017 was my "Elon Musk moment." Our university team was tasked with a "simple" project, but I convinced them to go bigger — let's 
                  model the <span className={styles.highlight}>Big Falcon Rocket</span>! Using VPython, I architected algorithms that simulated intercontinental 
                  ballistic trajectories, factoring in everything from passenger weight distribution to atmospheric pressure variations at different latitudes.
                </p>
                <p>
                  We built a digital twin of a rocket that didn't even exist yet, predicting flight paths that could revolutionize global travel. The 
                  simulation was so detailed, you could practically feel the G-forces. My teammates joked I was trying to get recruited by SpaceX. 
                  Little did they know, I was just warming up.
                </p>
              </div>

              {/* Teaching Revolution */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🎓 The Teaching Revolution: Kardashians Meet OOP</h3>
                <p>
                  As an instructor at MIPT, I faced my greatest challenge yet — teaching <span className={styles.highlightQuaternary}>OOP</span> to economics students who thought Python was a snake. 
                  Then inspiration struck during a late-night TV binge. The <span className={styles.highlightSecondary}>Kardashian family tree</span> became 
                  my teaching metaphor! Kim <span className={styles.highlightTertiary}>inheriting properties</span> from Kris, Kylie <span className={styles.highlightTertiary}>extending the Jenner class</span>, <span className={styles.highlightQuaternary}>encapsulation</span> through their private 
                  Instagram accounts — suddenly, inheritance and polymorphism made perfect sense.
                </p>
                <p>
                  That lesson went viral in the faculty. Professors started calling it <span className={styles.highlight}>"The Kardashian Method,"</span> and 
                  I realized that great engineering isn't just about writing elegant code — it's about translating complexity into stories that stick.
                </p>
              </div>

              {/* iOS Era */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>💻 The iOS Era: From Apps to AI</h3>
                <p>
                  The freelance years (2016-2019) were my digital nomad phase. I was crafting <span className={styles.highlightTertiary}>iOS apps</span> from coffee shops in Kyiv to co-working 
                  spaces in Moscow, each project pushing boundaries. But the real game-changer? Implementing <span className={styles.highlight}>CoreML</span> before 
                  it was cool, sneaking <span className={styles.highlightQuaternary}>AI into mobile apps</span> when most developers thought machine learning required a supercomputer.
                </p>
                <p>
                  One app used <span className={styles.highlightSecondary}>on-device intelligence</span> to predict user behavior patterns. Another leveraged <span className={styles.highlightTertiary}>computer vision</span> to identify objects 
                  in real-time. I wasn't just building apps; I was planting seeds of artificial intelligence in millions of pockets.
                </p>
              </div>

              {/* AI Revolution */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🧠 The AI Revolution: From Models to Magic</h3>
                <p>
                  By 2019, I'd fully transformed into an AI architect. At <span className={styles.highlight}>Forecsys</span>, I wasn't just building 
                  models — I was constructing digital immune systems for financial giants. Imagine creating an anti-fraud system that could spot 
                  a scammer faster than you can say "suspicious transaction," processing millions of data points with sub-second latency.
                </p>
                <p>
                  Leading a team of junior data scientists, I became the Morpheus to their Neos, teaching them not just to see the code, but to 
                  feel the data flowing through neural networks. We <span className={styles.highlightSecondary}>reduced production bugs by 30%</span>, but more 
                  importantly, we built systems that protected people's life savings.
                </p>
              </div>

              {/* Crisis Years */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🌍 The Crisis Years: When Code Meets Compassion</h3>
                <p>
                  2022 brought unexpected challenges. Working with <span className={styles.highlight}>Ukraine's Ministry of Health</span> during turbulent 
                  times, I architected secure pipelines processing real-time health signals at national scale. We built predictive models identifying 
                  diabetes complications before symptoms appeared, potentially saving thousands of lives. Every algorithm wasn't just math — it was 
                  hope, encrypted and deployed at scale.
                </p>
                <p>
                  This wasn't Silicon Valley glamour; this was engineering with purpose. <span className={styles.highlightSecondary}>GDPR compliance</span> wasn't 
                  a checkbox; it was a sacred promise to protect vulnerable citizens' data.
                </p>
              </div>

              {/* Agentic Era */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🚀 The Agentic Era: Building Digital Consciousness</h3>
                <p>
                  Since 2022, as an independent consultant, I've been pioneering the frontier of <span className={styles.highlight}>agentic AI</span>. 
                  Imagine AI agents that don't just respond — they anticipate, collaborate, and evolve. My crown jewel? A <span className={styles.highlightSecondary}>RAG-enhanced 
                  Proactive AI Agent</span> that synthesizes your entire digital life and optimizes your day before you've had your morning coffee.
                </p>
                <p>
                  Working with everyone from stealth startups to financial titans like <span className={styles.highlight}>JPMorgan</span> and <span className={styles.highlight}>Bloomberg</span>, 
                  I've architected systems that feel like science fiction:
                </p>
                <ul className={styles.achievementsList}>
                  <li><span className={styles.highlight}>Multi-agent orchestrators</span> where AI entities negotiate and collaborate like a digital parliament</li>
                  <li><span className={styles.highlight}>RAG pipelines</span> achieving 95% precision, turning information chaos into crystalline insights</li>
                  <li><span className={styles.highlight}>Agentic architectures</span> using Model Context Protocol (MCP) — basically giving AI agents their own API superpowers</li>
                  <li><span className={styles.highlight}>Real-time systems</span> processing 100M+ property records, predicting house prices within £8.7k accuracy</li>
                </ul>
                <p>
                  For <span className={styles.highlight}>SaleSphereAI</span>, I built an AI sales force that <span className={styles.highlightSecondary}>increased 
                  conversions by 200%</span>. Not through spam, but through understanding — agents that actually comprehend customer needs and respond 
                  with empathy at scale.
                </p>
              </div>

              {/* The Present */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🎯 The Present: Where Multiple Realities Converge</h3>
                <p>
                  Today, I'm not just an engineer — I'm an architect of digital possibility. My latest creation? A scientific literature analysis 
                  system using <span className={styles.highlight}>LangGraph</span> that reads 200+ papers and identifies reproducible experiments in 30 
                  minutes. What used to take researchers months now happens during a coffee break.
                </p>
                <p>I'm simultaneously:</p>
                <ul className={styles.achievementsList}>
                  <li>Mentoring <span className={styles.highlightSecondary}>100+ minds globally</span>, from Olympiad winners to future FAANG engineers</li>
                  <li>Building open-source Python courses with AI-powered grading systems</li>
                  <li>Creating YouTube content democratizing computer science education</li>
                  <li>Architecting the next generation of agentic systems that will fundamentally change how we interact with AI</li>
                </ul>
              </div>

              {/* Philosophy */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🔮 The Philosophy: Engineering Meets Art</h3>
                <p>
                  Here's what I've learned after <span className={styles.highlight}>10+ years in the trenches</span>: Great engineering isn't about 
                  writing perfect code — it's about understanding that every system we build is ultimately about humans. Whether it's a RAG pipeline 
                  or a multi-agent orchestrator, the metric that matters isn't just F1 scores or latency — it's <span className={styles.highlightSecondary}>impact</span>.
                </p>
                <p>
                  I see code as poetry, algorithms as symphonies, and every production deployment as a performance. When I architect a system, I'm 
                  not just thinking about scalability and fault tolerance — I'm imagining the developer who'll maintain it in three years, the 
                  end-user who'll depend on it, the business that'll grow with it.
                </p>
              </div>

              {/* The Future */}
              <div className={styles.paragraph}>
                <h3 className={styles.subheading}>🌟 The Future: What's Next?</h3>
                <p>
                  As I pursue cutting-edge ML research and continue pushing boundaries, I'm excited about what's coming: AGI assistants that truly 
                  understand context, agentic systems that self-improve, and AI that doesn't just process information but genuinely collaborates 
                  with human creativity.
                </p>
                <p>
                  But beyond the tech, I'm a father who cooks elaborate dinners while explaining recursion to my kid, a traveler who sees new cities 
                  as undiscovered algorithms, and someone who still occasionally dreams in basketball plays — except now, the players are neural 
                  networks passing gradients instead of basketballs.
                </p>
                <p className={styles.closingStatement}>
                  <strong>The journey from that basketball court to building AI agents that think, reason, and create has been wild. But here's 
                  the secret: I'm just getting started.</strong>
                </p>
              </div>

              {/* Call to Action */}
              <div className={styles.paragraph}>
                <p className={styles.cta}>
                  <em>Want to build something impossible together? Let's talk.</em>
                </p>
              </div>

              {/* Code Philosophy */}
              <div className={styles.codeBlock}>
                <div className={styles.codeHeader}>
                  <span className={styles.codeLanguage}>python</span>
                  <span className={styles.codeTitle}>life_philosophy.py</span>
                </div>
                <pre className={styles.codeContent}>
                  <span className={styles.comment}># My life philosophy in code</span>{'\n'}
                  <span className={styles.keyword}>while</span> universe.<span className={styles.function}>exists</span>():{'\n'}
                  {'    '}problems = universe.<span className={styles.function}>get_unsolved_problems</span>(){'\n'}
                  {'    '}<span className={styles.keyword}>for</span> problem <span className={styles.keyword}>in</span> problems:{'\n'}
                  {'        '}solution = <span className={styles.function}>engineer_with_passion</span>(problem){'\n'}
                  {'        '}<span className={styles.keyword}>if</span> solution.impact <span className={styles.operator}>{'>'}</span> <span className={styles.builtin}>0</span>:{'\n'}
                  {'            '}universe.<span className={styles.function}>deploy</span>(solution){'\n'}
                  {'            '}happiness <span className={styles.operator}>+=</span> <span className={styles.builtin}>float</span>(<span className={styles.string}>'inf'</span>){'\n'}
                  {'    '}<span className={styles.function}>learn_something_new</span>(){'\n'}
                  {'    '}<span className={styles.function}>teach_someone_else</span>(){'\n'}
                  {'    '}<span className={styles.function}>dream_bigger</span>()
                </pre>
              </div>

              {/* Footer */}
              <div className={styles.bioFooter}>
                <p>
                  <em>Currently architecting the future from London, one intelligent system at a time.</em> 🇬🇧✨
                </p>
              </div>

              {/* Timeline */}
              <div className={styles.timeline}>
                <h3 className={styles.timelineTitle}>Timeline</h3>
                <div className={styles.timelineItems}>
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2011</div>
                    <div className={styles.timelineContent}>
                      <h4>⚡ The Spark</h4>
                      <p>At 14, started modeling chaos theory and fell in love with complex systems</p>
                    </div>
                  </div>
                  
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2013</div>
                    <div className={styles.timelineContent}>
                      <h4>🔬 CERN Summer Program</h4>
                      <p>Mind-expanding experience that shaped my approach to problem-solving</p>
                    </div>
                  </div>
                  
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2013-16</div>
                    <div className={styles.timelineContent}>
                      <h4>📚 MIPT Studies</h4>
                      <p>Applied Mathematics and Physics at Moscow Institute of Physics and Technology</p>
                    </div>
                  </div>

                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2014-16</div>
                    <div className={styles.timelineContent}>
                      <h4>🎓 Teaching at MIPT</h4>
                      <p>Led STEM curriculum design and mentored technical instructors</p>
                    </div>
                  </div>

                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2016-19</div>
                    <div className={styles.timelineContent}>
                      <h4>📱 iOS Development</h4>
                      <p>Built native apps with Swift, early adoption of CoreML for on-device AI</p>
                    </div>
                  </div>

                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2019-22</div>
                    <div className={styles.timelineContent}>
                      <h4>🤖 ML Engineering</h4>
                      <p>Senior ML Engineer at Forecsys, building production forecasting systems</p>
                    </div>
                  </div>

                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2022-Now</div>
                    <div className={styles.timelineContent}>
                      <h4>🚀 Lead AI Engineer</h4>
                      <p>Independent consultant architecting agentic AI systems for startups and enterprises</p>
                    </div>
                  </div>
                  
                  <div className={styles.timelineItem}>
                    <div className={styles.timelineYear}>2025</div>
                    <div className={styles.timelineContent}>
                      <h4>🎯 MLX Program & YuriODev</h4>
                      <p>Completed intensive ML program, now building the AI education platform I wish existed when I started</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
};

export default AboutSection;
