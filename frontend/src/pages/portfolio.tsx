import HeroSection from '../components/sections/HeroSection/HeroSection';
import AboutSection from '../components/sections/AboutSection/AboutSection';
import PlatformSection from '../components/sections/PlatformSection/PlatformSection';
import ProjectsSection from '../components/sections/ProjectsSection/ProjectsSection';
import TimelineSection from '../components/sections/TimelineSection/TimelineSection';
import ConnectSection from '../components/sections/ConnectSection/ConnectSection';
import SkillsSection from '../components/sections/SkillsSection/SkillsSection';
import { useScrollToHash } from '../hooks/useScrollToHash';

const Portfolio = () => {
  useScrollToHash();

  return (
    <>
      <HeroSection />
      <AboutSection />
      <TimelineSection />
      <SkillsSection />
      <ProjectsSection />
      <PlatformSection />
      <ConnectSection />
    </>
  );
};

export default Portfolio;
