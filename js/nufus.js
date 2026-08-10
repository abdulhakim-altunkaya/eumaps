document.addEventListener('DOMContentLoaded', function() {
  const provinceLabel = document.querySelector('.map-container h2'); // select the <h2>
  const svg = document.getElementById('svg-display');

  if (!svg) {
    console.error('Inline SVG element not found');
    return;
  }

  // Select all paths and label circles with data-name or TR IDs
  const clickableEls = svg.querySelectorAll('path[data-name], circle[id^="TR"]');

  clickableEls.forEach(function(el) {
    el.style.cursor = 'pointer';

    el.addEventListener('click', function(event) {
      const provinceId = el.id.replace('TR', ''); // for circles with TRxx IDs
      const provinceName = el.getAttribute('data-name') || el.className.baseVal || '';
      console.log('Clicked province:', provinceName, 'ID:', provinceId);
      // Navigate to province page
      window.location.href = `https://kacmilyon.com/il-nufus.html?provinceId=${provinceId}`;
      event.stopPropagation();
    });

    el.addEventListener('mouseover', function() {
      el.style.fill = '#db3939ff';
      const provinceName = el.getAttribute('data-name') || el.className.baseVal || '';
      provinceLabel.textContent = provinceName;
    });

    el.addEventListener('mouseout', function() {
      el.style.fill = '';
      provinceLabel.textContent = 'Türkiye';
    });
  });

  console.log('✅ Event listeners added to', clickableEls.length, 'SVG elements');
});
