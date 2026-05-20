import { Header } from "../components/layout/Header"
import { AppFooter } from "../components/layout/AppFooter"
import { HeroSection } from "./HeroSection"
import "./style/HomePage.css"

export const HomePage = () =>{
  return(
    <div className="home-page-layout">
      <Header/>
      <div className="home-scroll-area">
        <HeroSection/>
        <AppFooter />
      </div>
    </div>
  )
}
