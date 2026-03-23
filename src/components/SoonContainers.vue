<script setup>
import { ref } from 'vue';

const dates = ref(['16 Abril', '30 Abril']);

/** `public/images/check_naranja.png` se sirve en la raíz del sitio */
const checkFlagSrc = `${import.meta.env.BASE_URL}images/check_naranja.png`;
</script>

<template>
  <div class="soon-container" style="position: relative;">
    <!-- bandera / check (public/images/check_naranja.png) -->
    <img
      :src="checkFlagSrc"
      alt=""
      class="soon-flag"
      width="50"
      height="50"
      role="presentation"
      style="position: absolute; top: -5px; right: 10px;"
    />
    <div class="soon-item-container">
      <div class="soon-item" v-for="(item, index) in dates" :key="index">
        <div class="soon-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="black"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="size-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M6.75 2.994v2.25m10.5-2.25v2.25m-14.252 13.5V7.491a2.25 2.25 0 0 1 2.25-2.25h13.5a2.25 2.25 0 0 1 2.25 2.25v11.251m-18 0a2.25 2.25 0 0 0 2.25 2.25h13.5a2.25 2.25 0 0 0 2.25-2.25m-18 0v-7.5a2.25 2.25 0 0 1 2.25-2.25h13.5a2.25 2.25 0 0 1 2.25 2.25v7.5m-6.75-6h2.25m-9 2.25h4.5m.002-2.25h.005v.006H12v-.006Zm-.001 4.5h.006v.006h-.006v-.005Zm-2.25.001h.005v.006H9.75v-.006Zm-2.25 0h.005v.005h-.006v-.005Zm6.75-2.247h.005v.005h-.005v-.005Zm0 2.247h.006v.006h-.006v-.006Zm2.25-2.248h.006V15H16.5v-.005Z"
            />
          </svg>
        </div>
        <div class="soon-text">
          <!--trim first 2 char on bold orange, rest of text normal orange-->
          <span style="color: #ff6600; font-weight: bold">{{ item.slice(0, 2) }} </span>
          <span style="color: #ff6600; font-weight: normal"> {{ item.slice(2) }}</span>
        </div>
      </div>
    </div>
    <div class="soon-dec">
    </div>
  </div>
</template>

<style scoped>
.soon-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background-color: #FAFAF9;
  min-height: 200px;
  width: 320px;
  border-radius: 20px;


}
.soon-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgb(255, 255, 255);
  border-radius: 50%;
  width: 50px;
  height: 50px;
  padding: 5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
.soon-text {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  display: flex;
  flex-direction: row;
  column-gap: 10px;
}
.soon-item {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  column-gap: 20px;
  background-color: #FAFAF9;
  width: 70%;
  border-radius:40px;
  -webkit-box-shadow: 12px 11px 15px -3px #949494;
  box-shadow: 12px 11px 15px -3px #949494;
  padding: 5px 0;

}
.soon-item-container {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.soon-dec {
  height: 10px;
  width: 50%;
  background-color: #D6D3D1;
  border-radius: 20px; 
  margin-top: 20px;
}
</style>
