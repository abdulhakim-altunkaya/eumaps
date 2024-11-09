import React from 'react';
import CommentDisplay from '../CommentDisplay'; 
import Footer from "../Footer";

function CustomsNotes() {
  return (
    <>
      <div className='customsNotesArea'>
          <h2>ÖNEMLİ NOTLAR VE SÜREÇ</h2>
          <div>

            <strong>1.</strong> Kesin ödeyeceğiniz miktar gümrüğe gittiğinizde belli olacaktır.
            <br/><span className="customsNotesAreaExtraMargin"></span>
            <strong>2.</strong> KDV ödediğinize ve geri aldığınıza dair bütün belgeleri, tercümesiyle birlikte yanınızda bulundurunuz.
            Tercümeyi arabayı aldığınız ülkedeki Türkiye elçiliği/konsolosluğundan yaptırınız.
            <br/><span className="customsNotesAreaExtraMargin"></span>
            <strong>3.</strong> Eğer ödediğiniz KDV'yi geri aldığınıza dair belge sunamazsanız, o vakit Fatura bedelinizden 
            ödediğiniz KDV düşülmeyecek,
            Türkiye'de daha fazla vergi ödeyeceksiniz. Bu durumda fatura bedeline kdv miktarını da ekleyip öyle hesaplayın.
            <br/><span className="customsNotesAreaExtraMargin"></span>
            <strong>4.</strong> 6 ay veya 24 ay konusu: Yurtdışında yaşayan vatandaşlar arabalarını Türkiye'de yabancı plakasıyla 24 ay 
            kullanabilirler. Ama dikkat edin,
            "yurtdışında yaşayanlar" deniliyor. Bu özel izne "Turistik Muafiyet" deniyor. Turistik muafiyetten faydalanan 
            vatandaş, arabasını iki sene sonra
            gelip gümrüğe kaydedemez. Kaydetmeye kalkışırsa cezası bulunmakta. Cezanın ne olduğu ve ne kadar olduğunu bilmiyoruz.
            <br/><span className="customsNotesAreaExtraMargin"></span>
            Yurtdışında yaşarken Türkiye'ye kesin dönüş yapan kişiler ise (Görevleri bitip Türkiyeye kesin dönüş yapan 
            memurlar gibi), altı ay içinde arabalarının
            gümrük işini bitirmeleri gerekiyor. Altı içinde bitirmezlerse, cezası var. Cezanın ne olduğu ve ne kadar 
            olduğunu bilmiyoruz.
            <br/> <span className="customsNotesAreaExtraMargin"></span>
            Türkiye'ye kesin dönüş yapan vatandaşlar ve memurların pasaportlarına iki senelik turistik muafiyet damgası 
            vurulmuş olsa bile, arabanızı altı ay içinde kaydetmeniz gerekiyor.
            <br/><span className="customsNotesAreaExtraMargin"></span>
            <strong>5.</strong> Üretim ile fatura yılları arasında fark olan araçlar yeni 
            olsalar bile İkinci el araç olarak muamele görürler.
            <br/><span className="customsNotesAreaExtraMargin"></span>
            <strong>6.</strong> Daha ilave bilgi için Ticaret Bakanlığının sitesini ziyaret edebilirsiniz: &nbsp;
            <a href="https://ticaret.gov.tr/gumruk-islemleri/sikca-sorulan-sorular/bireysel/bedelsiz-nakil-vasitasi-ithali">
            Ticaret Bakanlığı</a>

            <h4>GEREKLİ BELGELER:</h4>
            <strong>1.</strong> Dilekçe (Gideceğiniz gümrükte var)<br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>2.</strong> Taahhütname (Gideceğiniz gümrükte var)<br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>3.</strong> Sizin ve varsa eşinizin pasaportları ve ön sayfa fotokopileri
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>4.</strong> MEMURLAR İÇİN: kurumunuz personel dairesinden alacağınız yurtdışı görevinizin 
            başlama bitiş tarihlerini gösteren yazı.<br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>5.</strong> Yabancı ülkeden aldığınız ruhsat belgesi, tercümesi ve fotokopisi.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>6.</strong> Fatura ve Ödeme belgenizin (varsa orjinali), tercümesi ve fotokopisi.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>7.</strong> Ziraat Bankasından bir hesap açın, mobil programı telefonunuza indirin. Parayı hazırda tutun, gümrük ödemeleriniz Ziraat 
            Mobil programı üzerinden hemen yapabilirsiniz. Böylece aynı gün işiniz bitebilir. Aynı gün işiniz bitmezse 
            arabayı bir geceliğine gümrüğe bırakmanız gerekiyor.
            Bu da ekstra iş ve maliyet demek. Gecelik gümrük araba parkının 250 tl civarı ücreti var (2021 fiyatı).
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>8.</strong> Araç sigortanızı da götürmelisiniz. Türkiye'ye girdiğiniz sınır kapısında yabancı plakalı araçlara
            sigorta yapan küçük sigorta dükkanları var.
            Ordan sigorta yapabilirsiniz. Yada yabancı sigortanızı tercüme ettirerek götürebilirsiniz. Groupama 
            sigortanın bu acentesi yabancı plakalı araçlara sigorta yapıyor: +90530 592 4440.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>9.</strong> Aracınızı da tabiki götürmeniz gerekiyor. Gümrük muayene memuru aracı kontrol ediyor.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>Not:</strong> Tercümeleri aracı aldığınız ülkedeki Konsolosluktan yapmanız tavsiye olunur.

            <h4>SÜREÇ</h4>
            <strong>1.</strong> Randevu almaya gerek yok. Gümrükçülere gerek yok. İşinizi kendiniz halledebilirsiniz. Gümrükler sabah 8'de 
            açılıyor (2021 Şubat itibariyle).<br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>2.</strong> Gümrük işini 6 ay içinde yapmalısınız. Türkiye'ye girerken pasaportunuza iki yıl süre vurulmuş olsa bile 6 ay 
            içinde gümrük işini yapmalısınız.<br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>3.</strong> Gümrük işleri bittikten sonra TSE'den araç projenizi hazırlatmanız gerekiyor. Bunun için bir araç proje 
            hazırlayan bir firmayla 
            irtibata geçmeniz gerekiyor. Ankara'da bu işi yapan firmalardan bir tanesi: Yeni Anıl 
            Mühendislik (Tel: +905338192209). Telefonla arıyorsunuz onları, herşeyi hallediyorlar. Siz sadece en son TSE Kontrol
            Merkezine gidiyorsunuz. Yaklaşık 500-600 tl (2021 fiyatı) gidiyor.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>4.</strong> Araç fenni muayene. Herhangi bir TUVTURK istasyonunda oluyor.Yaklaşık 400-500 tl.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>5.</strong> Ankara'da iseniz Balgat 40.Noterine gidin. Diğer noterler bu işi bilmeyebiliyor bazen. Yaklaşık 250 tl.
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>6.</strong> Plaka basım yerine gidin. Yaklaşık 60 tl (2021 Şubat fiyatı).
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <strong>7.</strong> Son olarak elinizdeki araç ve gümrükten aldığınız belgelerle birlikte Vergi Müdürlüğüne gidin. 
            Ankara'da: Yenimahalle Yeğenbey Vergi Müdürlüğü. Burada aracınızı vergi sistemine kaydediyorlar, 
            sonra da MTVsini ödüyorsunuz. 
            <br /><span className="customsNotesAreaExtraMargin"></span>
            <p>Aracınız hayırlı olsun. Sorularınız için yorum bırakabilirsiniz veya: drysoftware1@gmail.com</p>


          </div>
        </div>
        <div> <CommentDisplay pageId={8}/></div>
        <div> <br/><br/><br/> <Footer /> </div>
    </>

  )
}

export default CustomsNotes