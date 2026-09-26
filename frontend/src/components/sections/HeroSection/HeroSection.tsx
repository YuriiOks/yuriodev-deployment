import React from 'react';
import Button from '../../ui/Button/Button';
import styles from './HeroSection.module.css';
import useTypewriter from '../../../hooks/useTypewriter';
import { EMAILS, IDENTITY } from '../../../data/site';

const messages = [
  "Architecting agentic AI systems (LangGraph, MCP)...",
  "Building production RAG pipelines (95% precision)...",
  "Deploying multi-agent workflows (200% conversion)...",
  "Engineering cloud-native ML platforms (×50 faster)...",
  "Mentoring 1000+ students in AI/ML...",
  "Democratizing AI education through YuriODev..."
];

// Screen readers get every line once, as plain text, instead of the
// character-by-character animation.
const messagesForScreenReaders = messages.map((message) => message.replace(/\.{3}$/, '.')).join(' ');

const HeroSection: React.FC = () => {
  const typedMessage = useTypewriter(messages);

  return (
    <section className={styles.heroSection} id="hero">
      <h1 className={styles.heroTitle}>{IDENTITY.name}</h1>
      <p className={styles.heroSubtitle}>AI/ML Systems Engineer | Agentic Architect</p>
      <div className={styles.typewriter} id="typewriter" aria-hidden="true">{typedMessage}</div>
      <p className="sr-only">{messagesForScreenReaders}</p>
      <div className={styles.codeBlock} role="region" aria-label="Profile information">
        <div className={styles.jsonGrid}>
          {/* First JSON File - Profile */}
          <div className={styles.jsonColumn}>
            <div className={styles.commandLine}>$ cat ./profile.json</div>
            <div className={styles.outputRoot}><span className={styles.jsonBraceOuter}>{'{'}</span></div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"name"</span>: <span className={styles.jsonString}>"{IDENTITY.name}"</span>,</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"title"</span>: <span className={styles.jsonString}>"{IDENTITY.title}"</span>,</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"specialization"</span>: <span className={styles.jsonString}>"Agentic Architect"</span>,</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"location"</span>: <span className={styles.jsonString}>"{IDENTITY.location}"</span>,</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"education"</span>: <span className={styles.jsonBrace}>{'{'}</span></div>
            <div className={styles.outputNested}>{'    '}<span className={styles.jsonKey}>"degree"</span>: <span className={styles.jsonString}>"BSc Computer Science"</span>,</div>
            <div className={styles.outputNested}>{'    '}<span className={styles.jsonKey}>"university"</span>: <span className={styles.jsonString}>"Moscow Institute of Physics and Technology"</span>,</div>
            <div className={styles.outputNested}>{'    '}<span className={styles.jsonKey}>"certifications"</span>: <span className={styles.jsonBracket}>[</span><span className={styles.jsonString}>"MLX Graduate"</span><span className={styles.jsonBracket}>]</span></div>
            <div className={styles.output}>{'  '}<span className={styles.jsonBrace}>{'}'}</span>,{''}</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"platform"</span>: <span className={styles.jsonString}>"YuriODev.co.uk"</span>,</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"mission"</span>: <span className={styles.jsonString}>"Democratizing AI/ML through hands-on learning"</span></div>
            <div className={styles.outputRoot}><span className={styles.jsonBraceOuter}>{'}'}</span></div>
          </div>
          
          {/* Second JSON File - Systems & Expertise */}
          <div className={styles.jsonColumn}>
            <div className={styles.commandLine}>$ cat ./systems.json</div>
            <div className={styles.outputRoot}><span className={styles.jsonBraceOuter}>{'{'}</span></div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"experience"</span>: <span className={styles.jsonString}>"10+ years in production AI"</span>,</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"core_expertise"</span>: <span className={styles.jsonBrace}>{'{'}</span></div>
            <div className={styles.outputNested}>{'    '}<span className={styles.jsonKey}>"agentic_systems"</span>: <span className={styles.jsonBracket}>[</span><span className={styles.jsonString}>"LangGraph"</span>, <span className={styles.jsonString}>"MCP"</span>, <span className={styles.jsonString}>"Multi-Agent"</span><span className={styles.jsonBracket}>]</span>,</div>
            <div className={styles.outputNested}>{'    '}<span className={styles.jsonKey}>"rag_pipelines"</span>: <span className={styles.jsonBracket}>[</span><span className={styles.jsonString}>"Vector DBs"</span>, <span className={styles.jsonString}>"Retrieval"</span>, <span className={styles.jsonString}>"Reranking"</span><span className={styles.jsonBracket}>]</span>,</div>
            <div className={styles.outputNested}>{'    '}<span className={styles.jsonKey}>"ml_ops"</span>: <span className={styles.jsonBracket}>[</span><span className={styles.jsonString}>"Cloud Native"</span>, <span className={styles.jsonString}>"CI/CD"</span>, <span className={styles.jsonString}>"Monitoring"</span><span className={styles.jsonBracket}>]</span></div>
            <div className={styles.output}>{'  '}<span className={styles.jsonBrace}>{'}'}</span>,{''}</div>
            <div className={styles.output}>{'  '}<span className={styles.jsonKey}>"status"</span>: <span className={styles.success}>"deploying_enterprise_ai"</span></div>
            <div className={styles.outputRoot}><span className={styles.jsonBraceOuter}>{'}'}</span></div>
          </div>
        </div>
        
        {/* Deployment command section */}
        <div className={styles.deploymentSection}>
          <div className={styles.commandLine}>$ ./deploy_ai_systems.sh --mode=production --scale=enterprise</div>
          <div className={`${styles.output} ${styles.success}`}>✓ Agentic frameworks initialized (LangGraph, MCP)...</div>
          <div className={`${styles.output} ${styles.success}`}>✓ RAG pipelines optimized (95% precision)...</div>
          <div className={`${styles.output} ${styles.success}`}>✓ Multi-agent systems deployed...</div>
          <div className={styles.output}>Ready to architect your next AI breakthrough.</div>
        </div>
      </div>
      <div className={styles.ctaButtons}>
        <Button href="#platform" className={styles.ctaButton}>Explore YuriODev Vision</Button>
        <Button href="#projects" className={styles.ctaButton}>View Research & Projects</Button>
        <Button href={`mailto:${EMAILS.contact}`} className={styles.ctaButton}>Collaborate with Me</Button>
      </div>
    </section>
  );
};

export default HeroSection;
