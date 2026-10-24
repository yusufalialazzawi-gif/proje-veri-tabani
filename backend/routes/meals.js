'use strict';

/**
 * Besin günlüğü uç noktaları.
 *
 * İki alt yönlendirici döner çünkü prompt'un istediği adresler iki farklı
 * kök altında:
 *   /api/meals            — öğün başlıkları ve öğüne besin ekleme
 *   /api/meal-items/:id   — tek bir besin kaydını güncelleme/silme
 *
 * TÜM uç noktalar oturum gerektirir; sahiplik ayrıca her SQL sorgusunda
 * meals.user_id üzerinden doğrulanır (servis katmanında).
 */

const express = require('express');
const controller = require('../controllers/mealController');
const { requireAuth } = require('../middleware/auth');

const mealsRouter = express.Router();
mealsRouter.use(requireAuth);

mealsRouter.get('/', controller.listMeals);
mealsRouter.post('/', controller.createMeal);
mealsRouter.post('/:id/items', controller.addMealItem);

const mealItemsRouter = express.Router();
mealItemsRouter.use(requireAuth);

mealItemsRouter.put('/:id', controller.updateMealItem);
mealItemsRouter.delete('/:id', controller.deleteMealItem);

module.exports = { mealsRouter, mealItemsRouter };
