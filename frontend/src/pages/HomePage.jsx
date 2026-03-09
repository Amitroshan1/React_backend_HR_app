import { Header } from "../components/layout/Header"
import { HeroSection } from "./HeroSection"
import "./style/HomePage.css"

export const HomePage = () =>{
  return(
    <div className="home-page-layout">
      <Header/>
      <div className="home-scroll-area">
        <HeroSection/>
      </div>
    </div>
  )
}