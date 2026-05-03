fetch("products.json")
  .then(res => res.json())
  .then(data => {
    let html = "";

    data.forEach(p => {
      html += `
        <div class="card">
          <img src="${p.image}">
          <h3>${p.name}</h3>
          <p>${p.price}</p>
          <a href="${p.link}">
            <button>Order</button>
          </a>
        </div>
      `;
    });

    document.getElementById("products").innerHTML = html;
  });
